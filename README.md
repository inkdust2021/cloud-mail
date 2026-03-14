<p align="center">
    <img src="doc/demo/logo.png" width="80px" />
    <h1 align="center">Cloud Mail</h1>
    <p align="center">基于 Cloudflare 的简约响应式邮箱服务，支持邮件发送、附件收发 🎉</p> 
    <p align="center">
        简体中文 | <a href="/README-en.md" style="margin-left: 5px">English </a>
    </p>
    <p align="center">
        <a href="https://github.com/maillab/cloud-mail/tree/main?tab=MIT-1-ov-file" target="_blank" >
            <img src="https://img.shields.io/badge/license-MIT-green" />
        </a>    
        <a href="https://github.com/maillab/cloud-mail/releases" target="_blank" >
            <img src="https://img.shields.io/github/v/release/maillab/cloud-mail" alt="releases" />
        </a>  
        <a href="https://github.com/maillab/cloud-mail/issues" >
            <img src="https://img.shields.io/github/issues/maillab/cloud-mail" alt="issues" />
        </a>  
        <a href="https://github.com/maillab/cloud-mail/stargazers" target="_blank">
            <img src="https://img.shields.io/github/stars/maillab/cloud-mail" alt="stargazers" />
        </a>  
        <a href="https://github.com/maillab/cloud-mail/forks" target="_blank" >
            <img src="https://img.shields.io/github/forks/maillab/cloud-mail" alt="forks" />
        </a>
    </p>
    <p align="center">
        <a href="https://trendshift.io/repositories/14418" target="_blank" >
            <img src="https://trendshift.io/api/badge/repositories/14418" alt="trendshift" >
        </a>
    </p>
</p>


## 项目简介

只需要一个域名，就可以创建多个不同的邮箱，类似各大邮箱平台，本项目支持署到 Cloudflare Workers ，降低服务器成本，搭建自己的邮箱服务

## 项目展示

- [在线演示](https://skymail.ink)<br>
- [部署文档](https://doc.skymail.ink)<br>

| ![](/doc/demo/demo1.png) | ![](/doc/demo/demo2.png) |
|-----------------------|-----------------------|
| ![](/doc/demo/demo3.png) | ![](/doc/demo/demo4.png) |




## 功能介绍

- **💰 低成本使用**： 可部署到 Cloudflare Workers 降低服务器成本

- **💻 响应式设计**：响应式布局自动适配PC和大部分手机端浏览器

- **📧 邮件发送**：集成Resend发送邮件，支持群发，内嵌图片和附件发送，发送状态查看

- **🛡️ 管理员功能**：可以对用户，邮件进行管理，RABC权限控制对功能及使用资源限制

- **📦 附件收发**：支持收发附件，使用R2对象存储保存和下载文件

- **🔔 邮件推送**：接收邮件后可以转发到TG机器人或其他服务商邮箱

- **📡 开放API**：支持批量创建临时邮箱、按邮箱地址拉取收件邮件

- **📈 数据可视化**：使用ECharts对系统数据详情，用户邮件增长可视化显示

- **🎨 个性化设置**：可以自定义网站标题，登录背景，透明度

- **🤖 人机验证**：集成Turnstile人机验证，防止人机批量注册

- **📜 更多功能**：正在开发中...



## 技术栈

- **平台**：[Cloudflare Workers](https://developers.cloudflare.com/workers/)

- **Web框架**：[Hono](https://hono.dev/)

- **ORM：**[Drizzle](https://orm.drizzle.team/)

- **前端框架**：[Vue3](https://vuejs.org/) 

- **UI框架**：[Element Plus](https://element-plus.org/) 

- **邮件推送：** [Resend](https://resend.com/)

- **缓存**：[Cloudflare KV](https://developers.cloudflare.com/kv/)

- **数据库**：[Cloudflare D1](https://developers.cloudflare.com/d1/)

- **文件存储**：[Cloudflare R2](https://developers.cloudflare.com/r2/)

## 开放 API

以下接口统一通过 `/api` 前缀对外暴露，Worker 内部实际路由为 `/public/...`。

### 1. 生成公开 API Key

先使用管理员账号生成公开 API Key，后续调用新接口时推荐放在 `X-API-Key` 请求头中。

如果你已经使用管理员账号登录前端，也可以直接在“系统设置 -> 开放 API”里一键查看、复制或重新生成 API Key。

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_admin_password"}' \
  https://your-domain.com/api/public/genToken
```

响应示例：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "token": "your_api_key_here"
  }
}
```

### 2. 批量创建临时邮箱

`POST /api/public/batch-create-emails`

单次最多创建 50 个临时邮箱，`expiryDays` 仅支持 `1`、`5`、`7`、`14`、`30`，默认值为 `7`。返回的 `pin_code` 会同时写入该邮箱账号密码，可用于后续登录系统。

创建出的邮箱前缀格式为：**First name + Last name + 1-4 位随机数字**，例如 `oliviasmith23@example.com`、`liamjohnson7@example.com`。系统会优先避开同域名下已存在的同名组合，尽可能减少重复名字。

请求参数：

- `count`：必填，创建数量，范围 `1-50`
- `domain`：可选，指定邮箱域名；未传时默认取 `domain` 环境变量中的第一个域名
- `expiryDays`：可选，过期天数，支持 `1 | 5 | 7 | 14 | 30`

请求示例：

```bash
curl -X POST \
  -H "X-API-Key: your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"count":5,"expiryDays":7}' \
  https://your-domain.com/api/public/batch-create-emails
```

响应示例：

```json
{
  "success": true,
  "created_count": 5,
  "emails": [
    {
      "id": 1,
      "address": "oliviasmith23@example.com",
      "pin_code": "482901",
      "expires_at": "2026-03-20T12:00:00.000Z"
    }
  ],
  "remaining_calls": 945
}
```

说明：

- 公开 API 默认共享 `1000` 次/日调用额度，`remaining_calls` 为本次调用后的剩余额度
- 临时邮箱过期后会自动失效，并停止继续接收新邮件

### 3. 获取指定邮箱收到的邮件

`GET /api/public/emails/:address/messages`

用于拉取指定临时邮箱收到的所有邮件。实际调用时建议将邮箱地址进行 URL 编码，例如把 `@` 编码成 `%40`。

系统前端邮箱侧栏也已提供“创建临时邮箱”按钮，可直接在页面中生成并使用临时邮箱。

请求示例：

```bash
curl -H "X-API-Key: your_api_key_here" \
  "https://your-domain.com/api/public/emails/oliviasmith23%40example.com/messages"
```

响应示例：

```json
[
  {
    "id": 1,
    "sender": "noreply@service.com",
    "subject": "您的验证码",
    "body": "您的验证码是：123456",
    "html": "<p>您的验证码是：<b>123456</b></p>",
    "received_at": "2026-03-13T12:30:00.000Z",
    "is_read": false
  }
]
```

## 目录结构

```
cloud-mail
├── mail-worker				    # worker后端项目
│   ├── src                  
│   │   ├── api	 			    # api接口层			
│   │   ├── const  			    # 项目常量
│   │   ├── dao                 # 数据访问层
│   │   ├── email			    # 邮件处理接收
│   │   ├── entity			    # 数据库实体
│   │   ├── error			    # 自定义异常
│   │   ├── hono			    # web框架配置、拦截器、全局异常等
│   │   ├── i18n			    # 语言国际化
│   │   ├── init			    # 数据库缓存初始化
│   │   ├── model			    # 响应体数据封装
│   │   ├── security			# 身份权限认证
│   │   ├── service			    # 业务服务层
│   │   ├── template			# 消息模板
│   │   ├── utils			    # 工具类
│   │   └── index.js			# 入口文件
│   ├── pageckge.json			# 项目依赖
│   └── wrangler.toml			# 项目配置
│
├── mail-vue				    # vue前端项目
│   ├── src
│   │   ├── axios 			    # axios配置
│   │   ├── components			# 自定义组件
│   │   ├── echarts			    # echarts组件导入
│   │   ├── i18n			    # 语言国际化
│   │   ├── init			    # 入站初始化
│   │   ├── layout			    # 主体布局组件
│   │   ├── perm			    # 权限认证
│   │   ├── request			    # api接口
│   │   ├── router			    # 路由配置
│   │   ├── store			    # 全局状态管理
│   │   ├── utils			    # 工具类
│   │   ├── views			    # 页面组件
│   │   ├── app.vue			    # 入口组件
│   │   ├── main.js			    # 入口js
│   │   └── style.css			# 全局css
│   ├── package.json			# 项目依赖
└── └── env.release				# 项目配置
```

## 赞助

<a href="https://doc.skymail.ink/support.html" >
<img width="170px" src="./doc/images/support.png" alt="">
</a>

## 许可证

本项目采用 [MIT](LICENSE) 许可证	


## 交流

[Telegram](https://t.me/cloud_mail_tg)
