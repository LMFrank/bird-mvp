# Bird MVP 本地 API 契约

> 适用版本：v0.2.0；文档日期：2026-07-27

## 边界与通用约定

- Base URL：`http://localhost:3001`
- 认证：无。接口面向本机或受信任局域网，不应直接暴露到公网。
- 数据边界：照片原文件、SQLite、模型、区域标签和评测产物保留在本地；API 只返回当前图库的结构化结果。
- 成功响应统一包含 `success: true`；参数错误返回 HTTP 400，不存在的图库、照片或连拍组返回 HTTP 404。

## 更新图库候选区域

`PATCH /api/library/:id`

请求：

```json
{"regionCode":"CN"}
```

`regionCode` 会转为大写并限制为 32 个字符。成功返回
`{"success":true,"regionCode":"CN"}`。后续识别使用对应区域 CSV 与 `captive.csv`
的并集；文件缺失时识别失败，不静默退回全球候选集。

## 写入单张人工真值

`PUT /api/photos/:id/confirmation`

请求字段：

- `status`: `confirmed | rejected | unknown`
- `subjectType`: `bird | non_bird | unknown`
- `scene`: `wild | captive | unknown`
- `nameScientific`、`nameZh`、`note`: 可选

已确认鸟类必须提供科学学名。非鸟会清空物种并强制 `scene=unknown`。明确是鸟但无法定种时使用
`subjectType=bird,status=unknown`。成功返回规范化后的 `confirmation`；非法组合返回
`400 INVALID_CONFIRMATION`。

```bash
curl -X PUT http://localhost:3001/api/photos/1/confirmation \
  -H 'Content-Type: application/json' \
  -d '{"status":"confirmed","subjectType":"bird","scene":"wild","nameScientific":"Nycticorax nycticorax","nameZh":"夜鹭"}'
```

## 物种资产与评测

- `GET /api/library/:id/assets`：返回按科学学名聚合的确认数、预测数、代表照片和最近时间。
- `GET /api/library/:id/evaluation`：返回总体、wild、captive Top1/Top5，非鸟拒识，鸟类误拒，自动通过精度/覆盖率，检测召回、平均/P95 耗时和连拍指标。

没有人工真值的比例返回 `null`，不会用模型分数代替真实准确率。

```bash
curl http://localhost:3001/api/library/1/evaluation
```

## 连拍分组与显式确认

- `GET /api/library/:id/sequences`：列出成员、代表照片、融合 Top5、pipeline fingerprint 和一致率。
- `POST /api/library/:id/sequences/rebuild`：按 EXIF 相邻时间和 embedding 相似度重建；可选请求字段为
  `maxGapMs`（1,000–300,000，默认 10,000）和 `minSimilarity`（默认 0.9）。
- `PUT /api/library/:id/sequences/:sequenceId/confirmation`：仅在使用方明确触发时把来源照片的结论传播到整组。

整组确认请求必须包含 `sourcePhotoId`、`status`、`subjectType`、`scene`，鸟类确认还需科学学名。
传播记录保存 `source=sequence_propagated` 和来源照片 ID；成功返回写入数量 `count`。

```bash
curl -X POST http://localhost:3001/api/library/1/sequences/rebuild \
  -H 'Content-Type: application/json' \
  -d '{"maxGapMs":10000,"minSimilarity":0.9}'
```

## 消费方与验证

这些接口由 React 图库详情、物种资产面板和评测面板消费。最小验证命令：

```bash
npm test
npm run smoke
python3 tests/e2e_user_flow.py
```
