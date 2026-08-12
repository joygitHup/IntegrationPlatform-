import { NextRequest, NextResponse } from 'next/server';
import { seedSystem } from '@/server/seed';

export async function POST(request: NextRequest) {
  try {
    const result = await seedSystem();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
