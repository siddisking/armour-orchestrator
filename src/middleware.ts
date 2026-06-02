import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  let origin = request.headers.get('origin') || '';
  
  // Check if origin is a local loopback address on any port
  const isLocalhost = origin.startsWith('http://localhost:') || 
                      origin.startsWith('http://127.0.0.1:') ||
                      origin.startsWith('https://localhost:') ||
                      origin === 'http://localhost' ||
                      origin === 'http://127.0.0.1';

  // Parse allowed origins from environment variable (comma-separated list)
  const envAllowed = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) 
    : [];

  const fallbackOrigin = envAllowed[0] || process.env.FRONTEND_URL || 'http://localhost:5173';

  // Determine if incoming origin is allowed
  const isAllowed = isLocalhost || 
                    envAllowed.includes(origin) || 
                    origin === process.env.FRONTEND_URL || 
                    origin === 'https://armour-frontend.pages.dev';

  if (!origin || !isAllowed) {
    origin = fallbackOrigin;
  }


  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,OPTIONS,PATCH,DELETE,POST,PUT',
        'Access-Control-Allow-Headers': 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization',
      },
    });
  }

  const response = NextResponse.next();
  
  // Set CORS headers for the actual request response dynamically
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.headers.set('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');


  return response;
}

export const config = {
  matcher: '/api/:path*',
};
