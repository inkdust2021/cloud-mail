import app from '../hono/hono';
import result from '../model/result';
import settingService from '../service/setting-service';
import publicService from '../service/public-service';

app.put('/setting/set', async (c) => {
	await settingService.set(c, await c.req.json());
	return c.json(result.ok());
});

app.get('/setting/query', async (c) => {
	const setting = await settingService.get(c);
	return c.json(result.ok(setting));
});

app.get('/setting/websiteConfig', async (c) => {
	const setting = await settingService.websiteConfig(c);
	return c.json(result.ok(setting));
})

app.put('/setting/setBackground', async (c) => {
	const key = await settingService.setBackground(c, await c.req.json());
	return c.json(result.ok(key));
});

app.delete('/setting/deleteBackground', async (c) => {
	await settingService.deleteBackground(c);
	return c.json(result.ok());
});

app.get('/setting/queryPublicApiToken', async (c) => {
	const data = await publicService.getToken(c);
	return c.json(result.ok(data));
});

app.post('/setting/refreshPublicApiToken', async (c) => {
	const data = await publicService.refreshToken(c);
	return c.json(result.ok(data));
});
