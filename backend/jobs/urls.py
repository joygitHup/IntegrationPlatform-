from django.urls import path

from jobs.views import (
    JobControlView,
    JobDetailView,
    JobListView,
    JobPreviewView,
    JobResetWatermarkView,
    JobTriggerView,
)

urlpatterns = [
    path("jobs", JobListView.as_view()),
    path("jobs/trigger", JobTriggerView.as_view()),
    path("jobs/control", JobControlView.as_view()),
    path("jobs/preview", JobPreviewView.as_view()),
    path("jobs/<str:id>", JobDetailView.as_view()),
    path("jobs/<str:id>/reset-watermark", JobResetWatermarkView.as_view()),
]
