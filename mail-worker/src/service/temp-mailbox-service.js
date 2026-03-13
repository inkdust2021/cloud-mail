import dayjs from 'dayjs';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import orm from '../entity/orm';
import tempMailbox from '../entity/temp-mailbox';
import account from '../entity/account';
import user from '../entity/user';
import email from '../entity/email';
import accountService from './account-service';
import roleService from './role-service';
import userService from './user-service';
import cryptoUtils from '../utils/crypto-utils';
import emailUtils from '../utils/email-utils';
import verifyUtils from '../utils/verify-utils';
import BizError from '../error/biz-error';
import { emailConst, isDel, settingConst } from '../const/entity-const';
import { t } from '../i18n/i18n';
import KvConst from '../const/kv-const';
import settingService from './setting-service';

const MAX_BATCH_COUNT = 50;
const DEFAULT_EXPIRY_DAYS = 7;
const ALLOWED_EXPIRY_DAYS = [1, 5, 7, 14, 30];
const ENGLISH_NAME_LIST = [
	'amelia', 'anna', 'aria', 'aubrey', 'ava', 'bella', 'brook', 'chloe', 'claire', 'daisy',
	'ella', 'elsa', 'emily', 'emma', 'eva', 'flora', 'grace', 'hannah', 'hazel', 'iris',
	'isla', 'ivy', 'julia', 'lily', 'luna', 'maya', 'mia', 'nina', 'olivia', 'ruby',
	'sarah', 'sofia', 'stella', 'sylvia', 'violet', 'zoe', 'adam', 'adrian', 'alex', 'arthur',
	'blake', 'bruce', 'caleb', 'carter', 'daniel', 'dylan', 'edgar', 'edwin', 'ethan', 'evan',
	'felix', 'finn', 'harry', 'henry', 'hudson', 'isaac', 'jack', 'jacob', 'james', 'jonah',
	'julian', 'kevin', 'leo', 'levi', 'liam', 'logan', 'lucas', 'mason', 'nathan', 'noah',
	'oliver', 'oscar', 'owen', 'ryan', 'samuel', 'theo', 'thomas', 'wyatt'
];

const tempMailboxService = {

	async batchCreate(c, params = {}) {
		const { count, domain, expiryDays } = this.parseCreateParams(c, params);
		const defaultRole = await roleService.selectDefaultRole(c);

		if (!defaultRole) {
			throw new BizError(t('roleNotExist'));
		}

		const expiresAt = dayjs().add(expiryDays, 'day').millisecond(0).toISOString();
		const usedAddressSet = new Set();
		const createdList = [];

		for (let index = 0; index < count; index += 1) {
			const address = await this.generateUniqueAddress(c, domain, usedAddressSet);
			const pinCode = this.generatePinCode();
			const { salt, hash } = await cryptoUtils.hashPassword(pinCode);

			const userId = await userService.insert(c, {
				email: address,
				password: hash,
				salt,
				type: defaultRole.roleId
			});

			await userService.updateUserInfo(c, userId, true);

			const accountRow = await orm(c)
				.insert(account)
				.values({
					email: address,
					userId,
					name: emailUtils.getName(address)
				})
				.returning()
				.get();

			const mailboxRow = await orm(c)
				.insert(tempMailbox)
				.values({
					userId,
					accountId: accountRow.accountId,
					address,
					pinCode,
					deleteUser: 1,
					expiresAt
				})
				.returning()
				.get();

			createdList.push({
				id: mailboxRow.mailboxId,
				address,
				pin_code: pinCode,
				expires_at: expiresAt
			});
		}

		return createdList;
	},

	async createForUser(c, params = {}, userId) {
		const { addEmail, manyEmail } = await settingService.query(c);

		if (!(addEmail === settingConst.addEmail.OPEN && manyEmail === settingConst.manyEmail.OPEN)) {
			throw new BizError(t('addAccountDisabled'));
		}

		const { domain, expiryDays } = this.parseMailboxOptions(c, params);
		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

		if (userRow.email !== c.env.admin) {
			if (roleRow.accountCount > 0) {
				const userAccountCount = await accountService.countUserAccount(c, userId);
				if (userAccountCount >= roleRow.accountCount) {
					throw new BizError(t('accountLimit'), 403);
				}
			}
		}

		const address = await this.generateUniqueAddress(c, domain, new Set());

		if (userRow.email !== c.env.admin && !roleService.hasAvailDomainPerm(roleRow.availDomain, address)) {
			throw new BizError(t('noDomainPermAdd'), 403);
		}

		const expiresAt = dayjs().add(expiryDays, 'day').millisecond(0).toISOString();
		const accountRow = await orm(c)
			.insert(account)
			.values({
				email: address,
				userId,
				name: emailUtils.getName(address)
			})
			.returning()
			.get();

		const mailboxRow = await orm(c)
			.insert(tempMailbox)
			.values({
				userId,
				accountId: accountRow.accountId,
				address,
				pinCode: '',
				deleteUser: 0,
				expiresAt
			})
			.returning()
			.get();

		return {
			...accountRow,
			tempMailboxId: mailboxRow.mailboxId,
			expiresAt: mailboxRow.expiresAt
		};
	},

	async listMessagesByAddress(c, address) {
		const mailboxRow = await this.requireActiveMailbox(c, address);

		const messageList = await orm(c)
			.select()
			.from(email)
			.where(and(
				eq(email.accountId, mailboxRow.accountId),
				eq(email.type, emailConst.type.RECEIVE),
				eq(email.isDel, isDel.NORMAL),
				ne(email.status, emailConst.status.SAVING)
			))
			.orderBy(desc(email.emailId))
			.all();

		return messageList.map((messageRow) => ({
			id: messageRow.emailId,
			sender: messageRow.sendEmail || '',
			subject: messageRow.subject || '',
			body: messageRow.text || emailUtils.htmlToText(messageRow.content),
			html: messageRow.content || '',
			received_at: this.toISOString(messageRow.createTime),
			is_read: messageRow.unread === emailConst.unread.READ
		}));
	},

	parseCreateParams(c, params) {
		const count = Number(params.count);
		const { domain, expiryDays } = this.parseMailboxOptions(c, params);

		if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_COUNT) {
			throw new BizError(t('publicCreateCountInvalid'));
		}

		return { count, domain, expiryDays };
	},

	parseMailboxOptions(c, params = {}) {
		const expiryDays = params.expiryDays == null ? DEFAULT_EXPIRY_DAYS : Number(params.expiryDays);
		const domain = this.normalizeDomain(c, params.domain);

		if (!ALLOWED_EXPIRY_DAYS.includes(expiryDays)) {
			throw new BizError(t('publicExpiryDaysInvalid'));
		}

		return { domain, expiryDays };
	},

	normalizeDomain(c, domain) {
		const domainList = this.getDomainList(c);

		if (domainList.length === 0) {
			throw new BizError(t('noDomainVariable'));
		}

		if (!domain) {
			return domainList[0];
		}

		const normalizedDomain = String(domain).trim().replace(/^@/, '').toLowerCase();

		if (!domainList.includes(normalizedDomain)) {
			throw new BizError(t('notExistDomain'));
		}

		return normalizedDomain;
	},

	getDomainList(c) {
		if (Array.isArray(c.env.domain)) {
			return c.env.domain.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
		}

		if (typeof c.env.domain === 'string' && c.env.domain.trim()) {
			try {
				const parsedDomain = JSON.parse(c.env.domain);
				if (Array.isArray(parsedDomain)) {
					return parsedDomain.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
				}
			} catch (e) {
				return [c.env.domain.trim().toLowerCase()];
			}
		}

		return [];
	},

	generatePinCode() {
		const number = this.getRandomNumber();
		return String(number % 1000000).padStart(6, '0');
	},

	generatePrefix() {
		const nameIndex = this.getRandomNumber() % ENGLISH_NAME_LIST.length;
		const name = ENGLISH_NAME_LIST[nameIndex];
		const digitLength = (this.getRandomNumber() % 4) + 1;
		const min = digitLength === 1 ? 0 : 10 ** (digitLength - 1);
		const max = (10 ** digitLength) - 1;
		const number = min + (this.getRandomNumber() % (max - min + 1));
		return `${name}${number}`;
	},

	getRandomNumber() {
		if (globalThis.crypto?.getRandomValues) {
			const array = new Uint32Array(1);
			globalThis.crypto.getRandomValues(array);
			return array[0];
		}

		return Math.floor(Math.random() * 0xFFFFFFFF);
	},

	async generateUniqueAddress(c, domain, usedAddressSet) {
		for (let index = 0; index < 20; index += 1) {
			const address = `${this.generatePrefix()}@${domain}`.toLowerCase();

			if (usedAddressSet.has(address)) {
				continue;
			}

			const accountRow = await accountService.selectByEmailIncludeDel(c, address);
			if (accountRow) {
				continue;
			}

			usedAddressSet.add(address);
			return address;
		}

		throw new BizError(t('publicTempEmailGenerateFailed'));
	},

	async requireActiveMailbox(c, address) {
		const normalizedAddress = this.normalizeAddress(address);
		const mailboxRow = await this.selectByAddress(c, normalizedAddress);

		if (!mailboxRow || mailboxRow.isDel === isDel.DELETE) {
			throw new BizError(t('publicTempEmailNotFound'), 404);
		}

		if (this.isExpired(mailboxRow)) {
			await this.expireMailbox(c, mailboxRow);
			throw new BizError(t('publicTempEmailExpired'), 410);
		}

		return mailboxRow;
	},

	normalizeAddress(address) {
		let normalizedAddress = String(address || '');

		try {
			normalizedAddress = decodeURIComponent(normalizedAddress);
		} catch (e) {
			throw new BizError(t('notEmail'));
		}

		normalizedAddress = normalizedAddress.trim().toLowerCase();

		if (!verifyUtils.isEmail(normalizedAddress)) {
			throw new BizError(t('notEmail'));
		}

		return normalizedAddress;
	},

	selectByAddress(c, address) {
		return orm(c)
			.select()
			.from(tempMailbox)
			.where(sql`${tempMailbox.address} COLLATE NOCASE = ${address}`)
			.get();
	},

	isExpired(mailboxRow) {
		return !dayjs(mailboxRow.expiresAt).isAfter(dayjs());
	},

	async expireMailbox(c, mailboxRow) {
		if (!mailboxRow || mailboxRow.isDel === isDel.DELETE) {
			return;
		}

		const deleteUser = Number(mailboxRow.deleteUser ?? 1) === 1;
		const tasks = [
			orm(c).update(tempMailbox).set({ isDel: isDel.DELETE }).where(eq(tempMailbox.mailboxId, mailboxRow.mailboxId)).run(),
			orm(c).update(account).set({ isDel: isDel.DELETE }).where(eq(account.accountId, mailboxRow.accountId)).run()
		];

		if (deleteUser) {
			tasks.push(
				orm(c).update(user).set({ isDel: isDel.DELETE }).where(eq(user.userId, mailboxRow.userId)).run(),
				c.env.kv?.delete ? c.env.kv.delete(KvConst.AUTH_INFO + mailboxRow.userId) : Promise.resolve()
			);
		}

		await Promise.all(tasks);
	},

	async clearExpired(c) {
		const now = dayjs().toISOString();
		const expiredList = await orm(c)
			.select()
			.from(tempMailbox)
			.where(and(
				eq(tempMailbox.isDel, isDel.NORMAL),
				sql`${tempMailbox.expiresAt} <= ${now}`
			))
			.all();

		if (expiredList.length === 0) {
			return 0;
		}

		const mailboxIds = expiredList.map((item) => item.mailboxId);
		const accountIds = [...new Set(expiredList.map((item) => item.accountId))];
		const userIds = [...new Set(expiredList.filter((item) => Number(item.deleteUser ?? 1) === 1).map((item) => item.userId))];

		const tasks = [
			orm(c).update(tempMailbox).set({ isDel: isDel.DELETE }).where(inArray(tempMailbox.mailboxId, mailboxIds)).run(),
			orm(c).update(account).set({ isDel: isDel.DELETE }).where(inArray(account.accountId, accountIds)).run()
		];

		if (userIds.length > 0) {
			tasks.push(
				orm(c).update(user).set({ isDel: isDel.DELETE }).where(inArray(user.userId, userIds)).run(),
				...(c.env.kv?.delete ? userIds.map((userId) => c.env.kv.delete(KvConst.AUTH_INFO + userId)) : [])
			);
		}

		await Promise.all(tasks);

		return expiredList.length;
	},

	toISOString(value) {
		const dateValue = dayjs(value);
		return dateValue.isValid() ? dateValue.toISOString() : value;
	}
};

export default tempMailboxService;
