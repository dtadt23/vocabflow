# =============================================================================
#  group_api.py — VocabFlow | Học Tập Theo Nhóm (Group Learning Blueprint)
#  Register trong app.py:
#      from group_api import groups_bp
#      app.register_blueprint(groups_bp)
# =============================================================================
#
#  DB Collections:
#    groups            — thông tin nhóm + bộ từ nhóm
#    group_members     — quan hệ user ↔ group (with role: owner | member)
#    group_progress    — tiến độ học của từng member cho từng bộ từ nhóm
#
#  API Endpoints:
#    POST   /api/groups                          — tạo nhóm mới (sinh mã nhóm)
#    GET    /api/groups                          — lấy danh sách nhóm của tôi
#    POST   /api/groups/join                     — tham gia nhóm bằng mã
#    GET    /api/groups/<gid>                    — chi tiết nhóm
#    DELETE /api/groups/<gid>                    — giải tán nhóm (owner)
#    POST   /api/groups/<gid>/leave              — rời nhóm (member)
#    DELETE /api/groups/<gid>/members/<uid>      — kick thành viên (owner)
#
#    GET    /api/groups/<gid>/decks              — lấy tất cả bộ từ nhóm
#    POST   /api/groups/<gid>/decks              — tạo bộ từ nhóm (owner)
#    PUT    /api/groups/<gid>/decks/<did>        — cập nhật bộ từ nhóm (owner)
#    DELETE /api/groups/<gid>/decks/<did>        — xóa bộ từ nhóm (owner)
#
#    GET    /api/groups/<gid>/progress           — tiến độ toàn nhóm (all members)
#    PUT    /api/groups/<gid>/progress/<did>     — cập nhật tiến độ cá nhân
#    GET    /api/groups/my-decks                 — bộ từ nhóm của tất cả nhóm tôi tham gia
# =============================================================================

import random
import string
from datetime import datetime
from functools import wraps

from bson.objectid import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from pymongo import MongoClient, ASCENDING, DESCENDING
import os

# ── Blueprint ────────────────────────────────────────────────────────────────
groups_bp = Blueprint("groups", __name__)

# ── DB (reuse connection từ app.py qua mongo URI) ────────────────────────────
_client = MongoClient(os.getenv("MONGO_URI"))
_db = _client.vocabflow_user

users_col          = _db.users
groups_col         = _db.groups
group_members_col  = _db.group_members
group_progress_col = _db.group_progress

# Indexes — chạy 1 lần khi import
groups_col.create_index("code", unique=True)
group_members_col.create_index([("group_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
group_progress_col.create_index([("group_id", ASCENDING), ("deck_id", ASCENDING), ("user_id", ASCENDING)])


# ── Helpers ──────────────────────────────────────────────────────────────────

MAX_MEMBERS = 30

def _gen_code(length=6):
    """Sinh mã nhóm ngẫu nhiên dạng ABC123 (6 ký tự, in hoa + số)."""
    chars = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choices(chars, k=length))
        if not groups_col.find_one({"code": code}):
            return code


def _is_member(group_id, user_id):
    return group_members_col.find_one({
        "group_id": ObjectId(group_id),
        "user_id":  ObjectId(user_id)
    }) is not None


def _is_owner(group_id, user_id):
    m = group_members_col.find_one({
        "group_id": ObjectId(group_id),
        "user_id":  ObjectId(user_id)
    })
    return m is not None and m.get("role") == "owner"


def _fmt_group(g, user_id=None):
    """Serialize một group document."""
    return {
        "id":          str(g["_id"]),
        "name":        g.get("name", ""),
        "description": g.get("description", ""),
        "code":        g.get("code", ""),
        "owner_name":  g.get("owner_name", ""),
        "member_count": group_members_col.count_documents({"group_id": g["_id"]}),
        "deck_count":  len(g.get("decks", [])),
        "created_at":  g.get("created_at", datetime.utcnow()).strftime("%Y-%m-%d"),
        "is_owner":    _is_owner(str(g["_id"]), user_id) if user_id else False,
    }


def _fmt_deck(d, deck_index):
    """Serialize một deck trong group."""
    return {
        "id":      d.get("id", str(deck_index)),
        "name":    d.get("name", ""),
        "words":   d.get("words", []),
        "created_at": d.get("created_at", datetime.utcnow()).strftime("%Y-%m-%d")
                      if isinstance(d.get("created_at"), datetime) else d.get("created_at", ""),
    }


# ── Routes ───────────────────────────────────────────────────────────────────

# ── 1. Tạo nhóm mới ─────────────────────────────────────────────────────────
@groups_bp.route("/api/groups", methods=["POST"])
@jwt_required()
def create_group():
    uid = get_jwt_identity()
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "Tên nhóm không được để trống"}), 400

    user = users_col.find_one({"_id": ObjectId(uid)})
    owner_name = user.get("username", "Ẩn danh") if user else "Ẩn danh"

    code = _gen_code()
    now  = datetime.utcnow()
    result = groups_col.insert_one({
        "name":        name,
        "description": data.get("description", ""),
        "code":        code,
        "owner_id":    ObjectId(uid),
        "owner_name":  owner_name,
        "decks":       [],
        "created_at":  now,
        "updated_at":  now,
    })
    gid = result.inserted_id
    # Thêm owner vào members
    group_members_col.insert_one({
        "group_id":  gid,
        "user_id":   ObjectId(uid),
        "username":  owner_name,
        "role":      "owner",
        "joined_at": now,
    })
    return jsonify({
        "msg": "Tạo nhóm thành công!",
        "group": {
            "id":   str(gid),
            "name": name,
            "code": code,
            "member_count": 1,
            "deck_count": 0,
            "is_owner": True,
            "created_at": now.strftime("%Y-%m-%d"),
        }
    }), 201


# ── 2. Danh sách nhóm của tôi ────────────────────────────────────────────────
@groups_bp.route("/api/groups", methods=["GET"])
@jwt_required()
def get_my_groups():
    uid = get_jwt_identity()
    memberships = list(group_members_col.find({"user_id": ObjectId(uid)}))
    result = []
    for m in memberships:
        g = groups_col.find_one({"_id": m["group_id"]})
        if g:
            fd = _fmt_group(g, uid)
            fd["my_role"] = m.get("role", "member")
            result.append(fd)
    return jsonify({"groups": result}), 200


# ── 3. Tham gia nhóm bằng mã ─────────────────────────────────────────────────
@groups_bp.route("/api/groups/join", methods=["POST"])
@jwt_required()
def join_group():
    uid  = get_jwt_identity()
    data = request.get_json() or {}
    code = (data.get("code") or "").strip().upper()
    if not code:
        return jsonify({"msg": "Vui lòng nhập mã nhóm"}), 400

    group = groups_col.find_one({"code": code})
    if not group:
        return jsonify({"msg": "Mã nhóm không tồn tại"}), 404

    gid = group["_id"]

    # Đã là thành viên?
    if _is_member(str(gid), uid):
        return jsonify({"msg": "Bạn đã là thành viên của nhóm này"}), 409

    # Kiểm tra số thành viên tối đa
    count = group_members_col.count_documents({"group_id": gid})
    if count >= MAX_MEMBERS:
        return jsonify({"msg": f"Nhóm đã đạt số thành viên tối đa ({MAX_MEMBERS} người)"}), 403

    user = users_col.find_one({"_id": ObjectId(uid)})
    username = user.get("username", "Ẩn danh") if user else "Ẩn danh"

    group_members_col.insert_one({
        "group_id":  gid,
        "user_id":   ObjectId(uid),
        "username":  username,
        "role":      "member",
        "joined_at": datetime.utcnow(),
    })
    return jsonify({
        "msg": f"Đã tham gia nhóm \"{group['name']}\" thành công!",
        "group": _fmt_group(group, uid),
    }), 200


# ── 4. Chi tiết nhóm ─────────────────────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>", methods=["GET"])
@jwt_required()
def get_group_detail(gid):
    uid = get_jwt_identity()
    if not ObjectId.is_valid(gid):
        return jsonify({"msg": "ID nhóm không hợp lệ"}), 400
    if not _is_member(gid, uid):
        return jsonify({"msg": "Bạn không phải thành viên nhóm này"}), 403

    group = groups_col.find_one({"_id": ObjectId(gid)})
    if not group:
        return jsonify({"msg": "Nhóm không tồn tại"}), 404

    # Members list
    members_raw = list(group_members_col.find({"group_id": ObjectId(gid)}))
    members = [{
        "user_id":   str(m["user_id"]),
        "username":  m.get("username", ""),
        "role":      m.get("role", "member"),
        "joined_at": m["joined_at"].strftime("%Y-%m-%d") if isinstance(m.get("joined_at"), datetime) else "",
    } for m in members_raw]

    # Decks
    decks = [_fmt_deck(d, i) for i, d in enumerate(group.get("decks", []))]

    fmt = _fmt_group(group, uid)
    fmt["members"] = members
    fmt["decks"]   = decks
    return jsonify({"group": fmt}), 200


# ── 5. Giải tán nhóm (owner only) ────────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>", methods=["DELETE"])
@jwt_required()
def delete_group(gid):
    uid = get_jwt_identity()
    if not ObjectId.is_valid(gid):
        return jsonify({"msg": "ID nhóm không hợp lệ"}), 400
    if not _is_owner(gid, uid):
        return jsonify({"msg": "Chỉ chủ nhóm mới có thể giải tán nhóm"}), 403

    groups_col.delete_one({"_id": ObjectId(gid)})
    group_members_col.delete_many({"group_id": ObjectId(gid)})
    group_progress_col.delete_many({"group_id": ObjectId(gid)})
    return jsonify({"msg": "Đã giải tán nhóm"}), 200


# ── 6. Rời nhóm ──────────────────────────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/leave", methods=["POST"])
@jwt_required()
def leave_group(gid):
    uid = get_jwt_identity()
    if not ObjectId.is_valid(gid):
        return jsonify({"msg": "ID nhóm không hợp lệ"}), 400
    if _is_owner(gid, uid):
        return jsonify({"msg": "Chủ nhóm không thể rời nhóm. Hãy giải tán nhóm nếu muốn."}), 403
    result = group_members_col.delete_one({"group_id": ObjectId(gid), "user_id": ObjectId(uid)})
    if result.deleted_count == 0:
        return jsonify({"msg": "Bạn không phải thành viên nhóm này"}), 404
    group_progress_col.delete_many({"group_id": ObjectId(gid), "user_id": ObjectId(uid)})
    return jsonify({"msg": "Đã rời nhóm"}), 200


# ── 7. Kick thành viên (owner only) ──────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/members/<string:target_uid>", methods=["DELETE"])
@jwt_required()
def kick_member(gid, target_uid):
    uid = get_jwt_identity()
    if not ObjectId.is_valid(gid):
        return jsonify({"msg": "ID nhóm không hợp lệ"}), 400
    if not _is_owner(gid, uid):
        return jsonify({"msg": "Chỉ chủ nhóm mới có quyền này"}), 403
    if target_uid == uid:
        return jsonify({"msg": "Không thể kick chính mình"}), 400
    result = group_members_col.delete_one({"group_id": ObjectId(gid), "user_id": ObjectId(target_uid)})
    if result.deleted_count == 0:
        return jsonify({"msg": "Không tìm thấy thành viên"}), 404
    group_progress_col.delete_many({"group_id": ObjectId(gid), "user_id": ObjectId(target_uid)})
    return jsonify({"msg": "Đã xóa thành viên khỏi nhóm"}), 200


# ── 8. Lấy bộ từ nhóm ───────────────────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/decks", methods=["GET"])
@jwt_required()
def get_group_decks(gid):
    uid = get_jwt_identity()
    if not _is_member(gid, uid):
        return jsonify({"msg": "Bạn không phải thành viên nhóm này"}), 403
    group = groups_col.find_one({"_id": ObjectId(gid)}, {"decks": 1})
    if not group:
        return jsonify({"msg": "Nhóm không tồn tại"}), 404
    decks = [_fmt_deck(d, i) for i, d in enumerate(group.get("decks", []))]
    return jsonify({"decks": decks}), 200


# ── 9. Tạo bộ từ nhóm (owner only) ──────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/decks", methods=["POST"])
@jwt_required()
def create_group_deck(gid):
    uid = get_jwt_identity()
    if not ObjectId.is_valid(gid):
        return jsonify({"msg": "ID không hợp lệ"}), 400
    if not _is_owner(gid, uid):
        return jsonify({"msg": "Chỉ chủ nhóm mới có thể tạo bộ từ"}), 403

    data  = request.get_json() or {}
    name  = (data.get("name") or "").strip()
    words = data.get("words", [])
    if not name:
        return jsonify({"msg": "Tên bộ từ không được để trống"}), 400

    deck_id = f"gd-{gid[:8]}-{int(datetime.utcnow().timestamp())}"
    new_deck = {
        "id":         deck_id,
        "name":       name,
        "words":      words,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    groups_col.update_one(
        {"_id": ObjectId(gid)},
        {"$push": {"decks": new_deck}, "$set": {"updated_at": datetime.utcnow()}}
    )
    return jsonify({"msg": "Tạo bộ từ nhóm thành công!", "deck": _fmt_deck(new_deck, 0)}), 201


# ── 10. Cập nhật bộ từ nhóm (owner only) ─────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/decks/<string:did>", methods=["PUT"])
@jwt_required()
def update_group_deck(gid, did):
    uid = get_jwt_identity()
    if not _is_owner(gid, uid):
        return jsonify({"msg": "Chỉ chủ nhóm mới có thể chỉnh sửa bộ từ"}), 403

    data = request.get_json() or {}
    set_fields = {}
    if "name"  in data: set_fields["decks.$.name"]       = data["name"]
    if "words" in data: set_fields["decks.$.words"]      = data["words"]
    set_fields["decks.$.updated_at"] = datetime.utcnow()
    set_fields["updated_at"]         = datetime.utcnow()

    result = groups_col.update_one(
        {"_id": ObjectId(gid), "decks.id": did},
        {"$set": set_fields}
    )
    if result.matched_count == 0:
        return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
    return jsonify({"msg": "Cập nhật bộ từ thành công!"}), 200


# ── 11. Xóa bộ từ nhóm (owner only) ─────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/decks/<string:did>", methods=["DELETE"])
@jwt_required()
def delete_group_deck(gid, did):
    uid = get_jwt_identity()
    if not _is_owner(gid, uid):
        return jsonify({"msg": "Chỉ chủ nhóm mới có thể xóa bộ từ"}), 403

    result = groups_col.update_one(
        {"_id": ObjectId(gid)},
        {"$pull": {"decks": {"id": did}}, "$set": {"updated_at": datetime.utcnow()}}
    )
    if result.modified_count == 0:
        return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
    group_progress_col.delete_many({"group_id": ObjectId(gid), "deck_id": did})
    return jsonify({"msg": "Đã xóa bộ từ"}), 200


# ── 12. Tiến độ toàn nhóm ────────────────────────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/progress", methods=["GET"])
@jwt_required()
def get_group_progress(gid):
    uid = get_jwt_identity()
    if not _is_member(gid, uid):
        return jsonify({"msg": "Bạn không phải thành viên nhóm này"}), 403

    group = groups_col.find_one({"_id": ObjectId(gid)})
    if not group:
        return jsonify({"msg": "Nhóm không tồn tại"}), 404

    members_raw = list(group_members_col.find({"group_id": ObjectId(gid)}))
    decks       = group.get("decks", [])

    # Tính tổng số từ mỗi deck
    deck_word_counts = {d["id"]: len(d.get("words", [])) for d in decks}

    # Lấy toàn bộ progress records của nhóm
    all_progress = list(group_progress_col.find({"group_id": ObjectId(gid)}))

    result = []
    for m in members_raw:
        mid = str(m["user_id"])
        user_prog = [p for p in all_progress if str(p["user_id"]) == mid]

        deck_details = []
        total_learned = 0
        total_words   = 0
        for d in decks:
            did       = d["id"]
            wc        = deck_word_counts.get(did, 0)
            learned   = len([p for p in user_prog
                             if p.get("deck_id") == did and p.get("status") == "learned"])
            pct       = round((learned / wc * 100) if wc > 0 else 0)
            total_learned += learned
            total_words   += wc
            deck_details.append({
                "deck_id":    did,
                "deck_name":  d.get("name", ""),
                "learned":    learned,
                "total":      wc,
                "percent":    pct,
            })

        overall_pct = round((total_learned / total_words * 100) if total_words > 0 else 0)
        result.append({
            "user_id":      mid,
            "username":     m.get("username", ""),
            "role":         m.get("role", "member"),
            "total_learned": total_learned,
            "total_words":  total_words,
            "overall_pct":  overall_pct,
            "decks":        deck_details,
        })

    # Sắp xếp theo tiến độ giảm dần
    result.sort(key=lambda x: x["overall_pct"], reverse=True)
    return jsonify({"progress": result, "my_id": uid}), 200


# ── 13. Cập nhật tiến độ cá nhân trong nhóm ──────────────────────────────────
@groups_bp.route("/api/groups/<string:gid>/progress/<string:did>", methods=["PUT"])
@jwt_required()
def update_group_progress(gid, did):
    uid  = get_jwt_identity()
    if not _is_member(gid, uid):
        return jsonify({"msg": "Bạn không phải thành viên nhóm này"}), 403

    data    = request.get_json() or {}
    word_id = data.get("word_id")
    status  = data.get("status")   # "learned" | "review"
    if not word_id or not status:
        return jsonify({"msg": "Thiếu word_id hoặc status"}), 400

    group_progress_col.update_one(
        {"group_id": ObjectId(gid), "deck_id": did,
         "user_id": ObjectId(uid), "word_id": word_id},
        {"$set": {"status": status, "updated_at": datetime.utcnow()}},
        upsert=True
    )
    return jsonify({"msg": "Đã cập nhật tiến độ"}), 200


# ── 14. Bộ từ nhóm của tất cả nhóm tôi tham gia (cho tab "Bộ Từ Nhóm") ───────
@groups_bp.route("/api/groups/my-decks", methods=["GET"])
@jwt_required()
def get_all_my_group_decks():
    uid = get_jwt_identity()
    memberships = list(group_members_col.find({"user_id": ObjectId(uid)}))
    result = []
    for m in memberships:
        g = groups_col.find_one({"_id": m["group_id"]})
        if not g:
            continue
        for d in g.get("decks", []):
            result.append({
                "group_id":   str(g["_id"]),
                "group_name": g.get("name", ""),
                "group_code": g.get("code", ""),
                "is_owner":   m.get("role") == "owner",
                **_fmt_deck(d, 0),
            })
    return jsonify({"decks": result}), 200