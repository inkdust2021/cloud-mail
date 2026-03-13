import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const tempMailbox = sqliteTable('temp_mailbox', {
	mailboxId: integer('mailbox_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	accountId: integer('account_id').notNull(),
	address: text('address').notNull(),
	pinCode: text('pin_code').notNull(),
	deleteUser: integer('delete_user').default(1).notNull(),
	expiresAt: text('expires_at').notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull(),
	isDel: integer('is_del').default(0).notNull()
});

export default tempMailbox;
