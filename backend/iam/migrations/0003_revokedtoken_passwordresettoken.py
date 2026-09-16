from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("iam", "0002_user_client"),
    ]

    operations = [
        migrations.CreateModel(
            name="RevokedToken",
            fields=[
                (
                    "id",
                    models.CharField(
                        editable=False, max_length=64, primary_key=True, serialize=False
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("jti", models.CharField(db_index=True, max_length=64, unique=True)),
                ("token_type", models.CharField(default="access", max_length=16)),
                (
                    "user_id",
                    models.CharField(
                        blank=True, db_index=True, default="", max_length=64
                    ),
                ),
                (
                    "expires_at",
                    models.DateTimeField(blank=True, db_index=True, null=True),
                ),
            ],
            options={
                "db_table": "sys_revoked_tokens",
                "indexes": [
                    models.Index(fields=["jti"], name="idx_revoked_jti"),
                    models.Index(fields=["expires_at"], name="idx_revoked_expires"),
                ],
            },
        ),
        migrations.CreateModel(
            name="PasswordResetToken",
            fields=[
                (
                    "id",
                    models.CharField(
                        editable=False, max_length=64, primary_key=True, serialize=False
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user_id", models.CharField(db_index=True, max_length=64)),
                ("token", models.CharField(db_index=True, max_length=128, unique=True)),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("used", models.BooleanField(default=False)),
            ],
            options={
                "db_table": "sys_password_reset_tokens",
                "indexes": [
                    models.Index(fields=["token"], name="idx_pwreset_token"),
                    models.Index(fields=["user_id"], name="idx_pwreset_user"),
                ],
            },
        ),
    ]
