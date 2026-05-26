import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../../../lib/db';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const client = await pool.connect();
    let user;
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE username = $1 OR email = $1',
        [username]
      );
      user = result.rows[0];
    } finally {
      client.release();
    }

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Create a manual JWT
    const secret = process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production';
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        role: user.role || 'Member' // Add role to token
      },
      secret,
      { expiresIn: '7d' } // Token expires in 7 days
    );

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.username,
        email: user.email,
        role: user.role || 'Member' // Add role to frontend response
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
