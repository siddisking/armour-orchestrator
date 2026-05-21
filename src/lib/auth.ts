import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { pool } from './db';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: "Username or Email", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error('Please enter your username and password.');
        }

        const client = await pool.connect();
        try {
          // Check if user exists (can log in with username OR email)
          const result = await client.query(
            'SELECT * FROM users WHERE username = $1 OR email = $1',
            [credentials.username]
          );

          const user = result.rows[0];

          if (!user) {
            throw new Error('No user found with that username or email.');
          }

          // Compare submitted password with securely hashed password in DB
          const isValid = await bcrypt.compare(credentials.password, user.password_hash);

          if (!isValid) {
            throw new Error('Incorrect password.');
          }

          // Return user object. NextAuth will automatically embed this into a secure JWT!
          return {
            id: user.id,
            name: user.username,
            email: user.email,
          };
        } finally {
          client.release();
        }
      }
    })
  ],
  session: {
    // Force use of secure JWT tokens stored in HttpOnly cookies
    strategy: 'jwt',
  },
  callbacks: {
    // 1. JWT Callback: Whenever a token is created or updated, we ensure our custom user ID is inside it
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    // 2. Session Callback: When the frontend requests the session, we expose the custom ID from the token
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
      }
      return session;
    }
  },
  // Used to encrypt the JWT securely
  secret: process.env.NEXTAUTH_SECRET || 'super-secret-key-replace-me-in-production',
};
