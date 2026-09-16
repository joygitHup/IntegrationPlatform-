from rest_framework import serializers

from org_sync.models import Department, UserDepartment


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = "__all__"


class UserDepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserDepartment
        fields = "__all__"
