import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

/**
 * A Higher-Order Function to protect Next.js API routes with RBAC.
 * 
 * @param requiredRole The role required to access the route (e.g. 'SuperAdmin')
 * @param handler The standard route handler function
 */
export function withAuth(
  requiredRole: string | null,
  handler: (req: NextRequest, user: any) => Promise<NextResponse> | NextResponse | Response | Promise<Response>
) {
  return async (req: NextRequest) => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];

    try {
      const secret = process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production';
      const decoded = jwt.verify(token, secret) as any;

      // Check if the user meets the required role
      if (requiredRole && decoded.role !== requiredRole) {
        return NextResponse.json({ error: `Forbidden: ${requiredRole} privileges required` }, { status: 403 });
      }

      // Pass execution back to the wrapped handler, injecting the decoded user payload
      return handler(req, decoded);
      
    } catch (err) {
      return NextResponse.json({ error: 'Unauthorized: Invalid token' }, { status: 401 });
    }
  };
}
