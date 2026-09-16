from rest_framework import serializers

from executions.models import DeadLetterMessage, FieldChangeAudit, JobExecution


class ExecutionSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobExecution
        fields = "__all__"


class DeadLetterSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeadLetterMessage
        fields = "__all__"


class FieldAuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = FieldChangeAudit
        fields = "__all__"
