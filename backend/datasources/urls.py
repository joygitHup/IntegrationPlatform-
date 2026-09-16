from django.urls import path

from datasources.views import (
    ConnectorDetailView,
    ConnectorListView,
    DatasourceDetailView,
    DatasourceInspectView,
    DatasourceListView,
    DatasourceTestView,
)

urlpatterns = [
    path("datasources", DatasourceListView.as_view()),
    path("datasources/test", DatasourceTestView.as_view()),
    path("datasources/inspect", DatasourceInspectView.as_view()),
    path("datasources/<str:id>", DatasourceDetailView.as_view()),
    path("connectors", ConnectorListView.as_view()),
    path("connectors/<str:type>", ConnectorDetailView.as_view()),
]
