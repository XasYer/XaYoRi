<div align="center">

# TRSS-Yunzai Plugin

TRSS-Yunzai 适配器 插件

</div>

## 安装教程
1. 准备：[TRSS-Yunzai](https://gitee.com/TimeRainStarSky/Yunzai)

2. 推荐使用git进行安装，以方便后续升级。在Yunzai目录打开终端，运行

```
// 使用github
git clone --depth=1 https://github.com/XasYer/XaYoRi.git ./plugins/XaYoRi

// 使用github代理
git clone --depth=1 https://mirror.ghproxy.com/https://github.com/XasYer/XaYoRi.git ./plugins/XaYoRi
```

3. 安装依赖

```
pnpm i
```

## 格式示例

- host `127.0.0.1` port `5500` Token `114514`

```
#Satori设置127.0.0.1:5500:114514
```

## 已支持消息格式

- [x] 文本
- [x] 图片
- [x] at
- [ ] 转发
- [x] 语音
- [ ] 视频
- [ ] 文件
- [x] 回复

## 配置

```yaml
node: 1 # 发送转发消息的模式 1: 合并发送(非转发) 2: 依次发送 3: 转图片(需ws-plugin)
img: raw # 接收的图片url格式 raw: 原始格式 md5: tx图链
```

## 访问量

<p align="center"><img src="https://moe-counter.glitch.me/get/@XasYer-XaYoRi?theme=rule34" /></p>