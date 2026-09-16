from django.core.management.base import BaseCommand

from iam.seed import seed_system


class Command(BaseCommand):
    help = "初始化角色、管理员账号与示例 SSO 应用"

    def handle(self, *args, **options):
        result = seed_system()
        self.stdout.write(self.style.SUCCESS(str(result)))
        if result.get("seeded"):
            self.stdout.write("默认管理员: admin / admin123")
