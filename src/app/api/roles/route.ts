import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { listRoles } from '@/server/services/user-service';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const roles = await listRoles();
  return NextResponse.json(roles);
}
