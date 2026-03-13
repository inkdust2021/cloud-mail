import app from '../hono/hono';
import result from '../model/result';
import publicService from '../service/public-service';

app.post('/public/genToken', async (c) => {
	const data = await publicService.genToken(c, await c.req.json());
	return c.json(result.ok(data));
});

app.post('/public/emailList', async (c) => {
	const list = await publicService.emailList(c, await c.req.json());
	return c.json(result.ok(list));
});

app.post('/public/addUser', async (c) => {
	await publicService.addUser(c, await c.req.json());
	return c.json(result.ok());
});

app.post('/public/batch-create-emails', async (c) => {
	const data = await publicService.batchCreateEmails(c, await c.req.json());
	return c.json(data);
});

app.get('/public/emails/:address/messages', async (c) => {
	const list = await publicService.getMessagesByAddress(c, c.req.param('address'));
	return c.json(list);
});
