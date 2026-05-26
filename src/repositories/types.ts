export interface User {
  id: string; // UUID
  username: string;
  email: string;
  password_hash: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}

export interface Chat {
  id: string; // UUID
  user_id: string; // UUID
  title: string;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string; // UUID
  chat_id: string; // UUID
  role: 'user' | 'model' | 'system';
  content: string;
  metadata: Record<string, any>;
  created_at: Date;
}
