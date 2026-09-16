from django.urls import path

from org_sync.views import DepartmentView, OrgSyncView, SyncTemplateView

urlpatterns = [
    path("org-departments", DepartmentView.as_view()),
    path("org-departments/sync", OrgSyncView.as_view()),
    path("sync-templates", SyncTemplateView.as_view()),
]
