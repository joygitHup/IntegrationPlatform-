"""IAM 序列化：对外不返回 passwordHash。"""
from rest_framework import serializers

from iam.models import Role, User


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "code", "name", "description", "status", "created_at"]


class UserSerializer(serializers.ModelSerializer):
    role_code = serializers.SerializerMethodField()
    role_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "display_name",
            "role_id",
            "status",
            "last_login_at",
            "login_fail_count",
            "created_at",
            "updated_at",
            "role_code",
            "role_name",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "last_login_at", "login_fail_count"]

    def get_role_code(self, obj) -> str | None:
        role = Role.objects.filter(id=obj.role_id).first() if obj.role_id else None
        return role.code if role else None

    def get_role_name(self, obj) -> str | None:
        role = Role.objects.filter(id=obj.role_id).first() if obj.role_id else None
        return role.name if role else None


class CreateUserSerializer(serializers.Serializer):
    username = serializers.RegexField(
        r"^[a-zA-Z][a-zA-Z0-9_.-]*$",
        min_length=3,
        max_length=64,
        error_messages={"invalid": "用户名须以字母开头，可包含字母、数字、下划线、点号和中划线"},
    )
    email = serializers.EmailField(required=False, allow_blank=True)
    display_name = serializers.CharField(max_length=64, required=False, allow_blank=True)
    password = serializers.CharField(min_length=6, max_length=128)
    role_id = serializers.CharField(max_length=32)
    # 仅平台账号可指派；客户账号传了也会被服务端强制覆盖为本客户
    client_id = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    status = serializers.ChoiceField(choices=["active", "disabled", "locked"], required=False, default="active")


class UpdateUserSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    display_name = serializers.CharField(max_length=64, required=False, allow_blank=True)
    role_id = serializers.CharField(max_length=32, required=False)
    status = serializers.ChoiceField(choices=["active", "disabled", "locked"], required=False)
    password = serializers.CharField(min_length=6, max_length=128, required=False, allow_blank=True)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=64)
    password = serializers.CharField(max_length=128)


class RefreshSerializer(serializers.Serializer):
    refresh_token = serializers.CharField()


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(max_length=128)
    new_password = serializers.CharField(min_length=6, max_length=128)
