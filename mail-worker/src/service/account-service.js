import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';
import emailUtils from '../utils/email-utils';
import userService from './user-service';
import emailService from './email-service';
import orm from '../entity/orm';
import account from '../entity/account';
import { and, asc, eq, gt, inArray, count, sql, ne, or, lt, desc } from 'drizzle-orm';
import {accountConst, isDel, settingConst} from '../const/entity-const';
import settingService from './setting-service';
import turnstileService from './turnstile-service';
import roleService from './role-service';
import { t } from '../i18n/i18n';
import verifyRecordService from './verify-record-service';
import tempMailbox from '../entity/temp-mailbox';
import user from '../entity/user';
import email from '../entity/email';
import { att } from '../entity/att';
import { star } from '../entity/star';

const accountService = {

	async add(c, params, userId) {

		const { addEmailVerify , addEmail, manyEmail, addVerifyCount, minEmailPrefix, emailPrefixFilter } = await settingService.query(c);

		let { email, token, force } = params;
		force = !!force;


		if (!(addEmail === settingConst.addEmail.OPEN && manyEmail === settingConst.manyEmail.OPEN)) {
			throw new BizError(t('addAccountDisabled'));
		}


		if (!email) {
			throw new BizError(t('emptyEmail'));
		}

		if (!verifyUtils.isEmail(email)) {
			throw new BizError(t('notEmail'));
		}

		if (!c.env.domain.includes(emailUtils.getDomain(email))) {
			throw new BizError(t('notExistDomain'));
		}

		if (emailUtils.getName(email).length < minEmailPrefix) {
			throw new BizError(t('minEmailPrefix', { msg: minEmailPrefix } ));
		}

		if (emailPrefixFilter.some(content => emailUtils.getName(email).includes(content))) {
			throw new BizError(t('banEmailPrefix'));
		}

		let accountRow = await this.selectByEmailIncludeDel(c, email);
		const userRow = await userService.selectById(c, userId);
		const isAdmin = userRow.email === c.env.admin;

		if (force && !isAdmin) {
			throw new BizError(t('unauthorized'), 403);
		}

		if (accountRow) {
			if (force && isAdmin) {
				return await this.forceAdd(c, accountRow, userId);
			}

			if (accountRow.isDel === isDel.DELETE) {
				throw new BizError(t('isDelAccount'));
			}

			throw new BizError(t('isRegAccount'));
		}
		const roleRow = await roleService.selectById(c, userRow.type);

		if (userRow.email !== c.env.admin) {

			if (roleRow.accountCount > 0) {
				const userAccountCount = await accountService.countUserAccount(c, userId)
				if(userAccountCount >= roleRow.accountCount) throw new BizError(t('accountLimit'), 403);
			}

			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {
				throw new BizError(t('noDomainPermAdd'),403)
			}

		}

		let addVerifyOpen = false

		if (isAdmin && force) {
			accountRow = await orm(c).insert(account).values({ email: email, userId: userId, name: emailUtils.getName(email) }).returning().get();
			accountRow.addVerifyOpen = false
			return accountRow;
		}

		if (addEmailVerify === settingConst.addEmailVerify.OPEN) {
			addVerifyOpen = true
			await turnstileService.verify(c, token);
		}

		if (addEmailVerify === settingConst.addEmailVerify.COUNT) {
			addVerifyOpen = await verifyRecordService.isOpenAddVerify(c, addVerifyCount);
			if (addVerifyOpen) {
				await turnstileService.verify(c,token)
			}
		}


		accountRow = await orm(c).insert(account).values({ email: email, userId: userId, name: emailUtils.getName(email) }).returning().get();

		if (addEmailVerify === settingConst.addEmailVerify.COUNT && !addVerifyOpen) {
			const row = await verifyRecordService.increaseAddCount(c);
			addVerifyOpen = row.count >= addVerifyCount
		}

		accountRow.addVerifyOpen = addVerifyOpen
		return accountRow;
	},

	async forceAdd(c, accountRow, userId) {
		const targetUser = await userService.selectById(c, userId);
		if (targetUser.email !== c.env.admin) {
			throw new BizError(t('unauthorized'), 403);
		}

		const primaryUser = await userService.selectByEmailIncludeDel(c, accountRow.email);
		const sourceUserId = accountRow.userId;

		if (accountRow.userId === userId && accountRow.isDel === isDel.NORMAL) {
			return accountRow;
		}

		const emailIds = await orm(c)
			.select({ emailId: email.emailId })
			.from(email)
			.where(eq(email.accountId, accountRow.accountId))
			.all();

		const emailIdList = emailIds.map(item => item.emailId);

		if (primaryUser && primaryUser.userId !== userId) {
			await userService.delete(c, primaryUser.userId);
			await orm(c)
				.update(account)
				.set({ isDel: isDel.DELETE })
				.where(and(
					eq(account.userId, primaryUser.userId),
					ne(account.accountId, accountRow.accountId)
				))
				.run();

			await orm(c)
				.update(tempMailbox)
				.set({ isDel: isDel.DELETE })
				.where(and(
					eq(tempMailbox.userId, primaryUser.userId),
					ne(tempMailbox.accountId, accountRow.accountId)
				))
				.run();
		}

		await orm(c).update(account).set({
			userId,
			isDel: isDel.NORMAL,
			name: emailUtils.getName(accountRow.email)
		}).where(eq(account.accountId, accountRow.accountId)).run();

		await orm(c).update(email).set({ userId }).where(eq(email.accountId, accountRow.accountId)).run();
		await orm(c).update(att).set({ userId }).where(eq(att.accountId, accountRow.accountId)).run();
		await orm(c).update(tempMailbox).set({ userId, deleteUser: 0, isDel: isDel.NORMAL }).where(eq(tempMailbox.accountId, accountRow.accountId)).run();

		if (emailIdList.length > 0) {
			await orm(c).delete(star).where(inArray(star.emailId, emailIdList)).run();
		}

		if (sourceUserId !== userId && sourceUserId !== primaryUser?.userId) {
			const remainCount = await orm(c)
				.select({ total: count() })
				.from(account)
				.where(and(eq(account.userId, sourceUserId), eq(account.isDel, isDel.NORMAL)))
				.get();

			if (!remainCount?.total) {
				await userService.delete(c, sourceUserId);
			}
		}

		return await orm(c).select().from(account).where(eq(account.accountId, accountRow.accountId)).get();
	},

	selectByEmailIncludeDel(c, email) {
		return orm(c).select().from(account).where(sql`${account.email} COLLATE NOCASE = ${email}`).get();
	},

	list(c, params, userId) {

		let { accountId, size, lastSort } = params;

		accountId = Number(accountId);
		size = Number(size);
		lastSort = Number(lastSort);

		if (size > 30) {
			size = 30;
		}

		if (!accountId) {
			accountId = 0;
		}

		if(Number.isNaN(lastSort)) {
			lastSort = 9999999999;
		}

		return orm(c).select({
			...account,
			tempMailboxId: tempMailbox.mailboxId,
			expiresAt: tempMailbox.expiresAt
		}).from(account)
			.leftJoin(
				tempMailbox,
				and(
					eq(tempMailbox.accountId, account.accountId),
					eq(tempMailbox.isDel, isDel.NORMAL)
				)
			)
			.where(
			and(
				eq(account.userId, userId),
				eq(account.isDel, isDel.NORMAL),
					or(
						lt(account.sort, lastSort),
						and(
							eq(account.sort, lastSort),
							gt(account.accountId, accountId)
						)
					))
				)
			.orderBy(desc(account.sort), asc(account.accountId))
			.limit(size)
			.all();
	},

	async delete(c, params, userId) {

		let { accountId } = params;

		const user = await userService.selectById(c, userId);
		const accountRow = await this.selectById(c, accountId);

		if (accountRow.email === user.email) {
			throw new BizError(t('delMyAccount'));
		}

		if (accountRow.userId !== user.userId) {
			throw new BizError(t('noUserAccount'));
		}

		await orm(c).update(account).set({ isDel: isDel.DELETE }).where(
			and(eq(account.userId, userId),
				eq(account.accountId, accountId)))
			.run();

		await orm(c).update(tempMailbox).set({ isDel: isDel.DELETE }).where(eq(tempMailbox.accountId, accountId)).run();
	},

	selectById(c, accountId) {
		return orm(c).select().from(account).where(
			and(eq(account.accountId, accountId),
				eq(account.isDel, isDel.NORMAL)))
			.get();
	},

	async insert(c, params) {
		await orm(c).insert(account).values({ ...params }).returning();
	},

	async insertList(c, list) {
		await orm(c).insert(account).values(list).run();
	},

	async physicsDeleteByUserIds(c, userIds) {
		await emailService.physicsDeleteUserIds(c, userIds);
		await orm(c).delete(account).where(inArray(account.userId,userIds)).run();
	},

	async selectUserAccountCountList(c, userIds, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: account.userId,
				count: count(account.accountId)
			})
			.from(account)
			.where(and(
				inArray(account.userId, userIds),
				eq(account.isDel, del)
			))
			.groupBy(account.userId)
		return result;
	},

	async countUserAccount(c, userId) {
		const { num } = await orm(c).select({num: count()}).from(account).where(and(eq(account.userId, userId),eq(account.isDel, isDel.NORMAL))).get();
		return num;
	},

	async restoreByEmail(c, email) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.email, email)).run();
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.userId, userId)).run();
	},

	async setName(c, params, userId) {
		const { name, accountId } = params
		if (name.length > 30) {
			throw new BizError(t('usernameLengthLimit'));
		}
		await orm(c).update(account).set({name}).where(and(eq(account.userId, userId),eq(account.accountId, accountId))).run();
	},

	async allAccount(c, params) {

		let { userId, num, size } = params

		userId = Number(userId)

		num = Number(num)
		size = Number(size)

		if (size > 30) {
			size = 30;
		}

		num = (num - 1) * size;

		const userRow = await userService.selectByIdIncludeDel(c, userId);

		const list = await orm(c).select().from(account).where(and(eq(account.userId, userId),ne(account.email,userRow.email))).limit(size).offset(num);
		const { total } = await orm(c).select({ total: count() }).from(account).where(eq(account.userId, userId)).get();

		return { list, total }
	},

	async physicsDelete(c, params) {
		const { accountId } = params
		await emailService.physicsDeleteByAccountId(c, accountId)
		await orm(c).delete(tempMailbox).where(eq(tempMailbox.accountId, accountId)).run();
		await orm(c).delete(account).where(eq(account.accountId, accountId)).run();
	},

	async setAllReceive(c, params, userId) {
		let a = null
		const { accountId } = params;
		const accountRow = await this.selectById(c, accountId);
		if (accountRow.userId !== userId) {
			return;
		}
		await orm(c).update(account).set({ allReceive: accountConst.allReceive.CLOSE }).where(eq(account.userId, userId)).run();
		await orm(c).update(account).set({ allReceive: accountRow.allReceive ? 0 : 1 }).where(eq(account.accountId, accountId)).run();
	},

	async setAsTop(c, params, userId) {
		const { accountId } = params;
		console.log(accountId);
		const userRow = await userService.selectById(c, userId);
		const mainAccountRow = await accountService.selectByEmailIncludeDel(c, userRow.email);
		let mainSort = mainAccountRow.sort === 0 ? 2 : mainAccountRow.sort + 1;
		await orm(c).update(account).set({ sort: mainSort }).where(eq(account.email, userRow.email )).run();
		await orm(c).update(account).set({ sort: mainSort - 1 }).where(and(eq(account.accountId, accountId),eq(account.userId,userId))).run();
	}
};

export default accountService;
