import { pool } from '../lib/db';
import { Chat, Message } from './types';

export class ChatRepository {
  /**
   * Creates a new chat thread for a user.
   */
  async createChat(userId: string, title: string): Promise<Chat> {
    const query = `
      INSERT INTO chats (user_id, title)
      VALUES ($1, $2)
      RETURNING id, user_id, title, is_deleted, created_at, updated_at;
    `;
    const { rows } = await pool.query(query, [userId, title]);
    return rows[0];
  }

  /**
   * Retrieves all active (non-deleted) chat sessions belonging to a user ordered by last updated.
   */
  async getUserChats(userId: string): Promise<Chat[]> {
    const query = `
      SELECT id, user_id, title, is_deleted, created_at, updated_at
      FROM chats
      WHERE user_id = $1 AND is_deleted = FALSE
      ORDER BY updated_at DESC;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  /**
   * Fetches a single active chat session belonging to a specific user (direct query check).
   */
  async getUserChat(chatId: string, userId: string): Promise<Chat | null> {
    const query = `
      SELECT id, user_id, title, is_deleted, created_at, updated_at
      FROM chats
      WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE;
    `;
    const { rows } = await pool.query(query, [chatId, userId]);
    return rows[0] || null;
  }

  /**
   * Retrieves chronological message history for an active chat session.
   */
  async getChatMessages(chatId: string): Promise<Message[]> {
    const query = `
      SELECT m.id, m.chat_id, m.role, m.content, m.metadata, m.created_at
      FROM messages m
      JOIN chats c ON m.chat_id = c.id
      WHERE m.chat_id = $1 AND c.is_deleted = FALSE
      ORDER BY m.created_at ASC;
    `;
    const { rows } = await pool.query(query, [chatId]);
    return rows;
  }

  /**
   * Saves a dialogue message to the thread.
   */
  async saveMessage(
    chatId: string,
    role: 'user' | 'model' | 'system',
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<Message> {
    const query = `
      INSERT INTO messages (chat_id, role, content, metadata)
      VALUES ($1, $2, $3, $4)
      RETURNING id, chat_id, role, content, metadata, created_at;
    `;
    const { rows } = await pool.query(query, [chatId, role, content, JSON.stringify(metadata)]);
    
    return rows[0];
  }

  /**
   * Performs a logical soft delete on a chat session.
   */
  async deleteChat(chatId: string, userId: string): Promise<boolean> {
    const query = `
      UPDATE chats
      SET is_deleted = TRUE
      WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE;
    `;
    const { rowCount } = await pool.query(query, [chatId, userId]);
    return (rowCount ?? 0) > 0;
  }

  /**
   * Updates a chat thread's title dynamically if active.
   */
  async updateChatTitle(chatId: string, title: string): Promise<void> {
    const query = `
      UPDATE chats
      SET title = $1
      WHERE id = $2 AND is_deleted = FALSE;
    `;
    await pool.query(query, [title, chatId]);
  }
}
