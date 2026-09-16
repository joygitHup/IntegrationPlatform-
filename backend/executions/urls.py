from django.urls import path

from executions.views import (
    DeadLetterView,
    ExecutionDetailView,
    ExecutionListView,
    FieldAuditView,
    VersionSnapshotView,
    WorkflowRunView,
)

urlpatterns = [
    path("executions", ExecutionListView.as_view()),
    path("executions/<str:id>", ExecutionDetailView.as_view()),
    path("dead-letters", DeadLetterView.as_view()),
    path("field-audit", FieldAuditView.as_view()),
    path("version-snapshots", VersionSnapshotView.as_view()),
    path("workflows", WorkflowRunView.as_view()),
]
