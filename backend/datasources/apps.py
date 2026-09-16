from django.apps import AppConfig


class DatasourcesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "datasources"
    verbose_name = "数据源"

    def ready(self) -> None:
        from datasources.connectors import registry  # noqa: F401  注册内置连接器
