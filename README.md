# 承佳豪个人主页 · 数字分身原型

一个「简约高级 / 黑白 / 瑞士网格极简解构版式 / 移动端适配」的个人主页原型，包含头像、姓名与一句话介绍、个人信息展示区，以及接入 DeepSeek 的数字分身聊天区。

## 技术栈
- 前端：纯 HTML + CSS + JavaScript（无框架、无构建工具）
- 后端：`server.js`（Node.js 零依赖，仅用内置模块）
- AI：DeepSeek Chat Completions（OpenAI 兼容）

## 运行步骤

1. 安装 Node.js（本机已确认 v24）。

2. 配置 API Key：
   ```powershell
   Copy-Item .env.example .env
   ```
   然后用编辑器打开 `.env`，把 `DEEPSEEK_API_KEY=` 后面填上你的 DeepSeek Key。

   > 也可用环境变量：`set DEEPSEEK_API_KEY=你的Key`

3. 启动服务：
   ```powershell
   node server.js
   ```

4. 打开浏览器访问：
   ```
   http://127.0.0.1:3000
   ```

## 说明
- API Key 只保存在服务端（`.env` 或环境变量），不会暴露到浏览器。
- 数字分身的人设（system prompt）唯一来源是 `rag/system.md`：本地 `server.js` 启动时直接读取；线上由 Dify 平台配置，修改后需重新上传到 Dify 知识库。
- 头像当前为「承」字占位，后续可替换为真人照片：修改 `index.html` 中 `.avatar` 区块即可。
- DeepSeek 接口地址与模型名集中在 `server.js` 顶部常量，便于更换。

## 文件结构
```
personal/
├── index.html      # 页面结构
├── styles.css      # 瑞士网格黑白主题样式
├── script.js       # 聊天交互
├── server.js       # 本地：静态服务 + DeepSeek 代理
├── edge-functions/api/chat.js  # 线上：EdgeOne Pages 云函数，转发到 Dify
├── rag/system.md   # 数字分身人设（唯一来源，本地与 Dify 共用）
├── .env.example    # 配置示例
└── README.md
```
