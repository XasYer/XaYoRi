logger.info(logger.yellow('- 正在加载 Satori 适配器插件'))

import fs from 'node:fs'
import WebSocket from 'ws'
import fetch from 'node-fetch'
import { join } from 'node:path'
import { parse } from 'node-html-parser'
import { encode as encodeSilk } from 'silk-wasm'
import { createHash, randomUUID } from 'node:crypto'
import Runtime from '../../lib/plugins/runtime.js'
import Handler from '../../lib/plugins/handler.js'
import makeConfig from '../../lib/plugins/config.js'

const { config, configSave } = await makeConfig('Satori', {
    img: 'md5',
    node: 1,
    token: []
})

class SatoriBot {
    constructor(host, port, token) {
        this.id = "QQ"
        this.name = 'satori'
        this.adapter = this
        this.host = host
        this.port = port
        this.token = token
        this.fl = new Map
        this.gl = new Map
        this.gml = new Map
        this.stat = {
            start_time: Date.now() / 1000
        }
    }

    async sendApi(api, body) {
        return await fetch(`http://${this.host}:${this.port}/v1/${api}`, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                Authorization: 'Bearer ' + this.token,
                'Content-Type': 'application/json',
                'X-Platform': this.platform,
                'X-Self-ID': this.self_id
            }
        }).then(async r => {
            return await r.json()
        })
    }

    sendWs(op, body) {
        this.ws.send(JSON.stringify({ op, body }))
    }

    pickGroup(group_id) {
        const i = {
            ...this.gl.get(group_id),
            group_id
        }
        return {
            ...i,
            sendMsg: msg => this.sendGroupMsg(group_id, msg),
            pickMember: user_id => this.pickMember(group_id, user_id),
            recallMsg: message_id => this.deleteMsg(message_id),
            muteMember: (user_id, duration) => this.mute(group_id, user_id, duration),
            kickMember: (user_id) => this.setGroupKick(group_id, user_id, false),
            quit: () => this.setGroupLeave(group_id),
            makeForwardMsg: msg => { return { type: "node", data: msg } },
            pokeMember: (user_id) => this.pickMember(group_id, user_id).poke(user_id),
            getAvatarUrl: (size = 0, history = 0) => `https://p.qlogo.cn/gh/${group_id}/${group_id}${history ? "_" + history : ""}/` + size
        }
    }

    pickFriend(user_id) {
        const i = {
            ...this.gl.get(user_id),
            user_id
        }
        return {
            ...i,
            sendMsg: msg => this.sendPrivateMsg(user_id, msg),
            recallMsg: message_id => this.deleteMsg(message_id),
            delete: block => this.deleteFriend(user_id, block),
            makeForwardMsg: msg => { return { type: "node", data: msg } },
            poke: () => this.poke(`private:${user_id}`),
            getAvatarUrl: (size = 0) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${user_id}`
        }
    }

    pickMember(group_id, user_id) {
        const i = {
            ...this.fl.get(user_id),
            ...this.gml.get(group_id)?.get(user_id),
            group_id,
            user_id
        }
        return {
            ...i,
            ...this.pickFriend(user_id),
            kick: (user_id) => this.setGroupKick(group_id, user_id, false),
            getAvatarUrl: (size = 0) => `https://q1.qlogo.cn/g?b=qq&s=${size}&nk=${user_id}`,
            poke: (id) => this.poke(group_id, id ? id : user_id),
            mute: (user_id, duration) => this.mute(group_id, user_id, duration)
        }
    }

    deleteFriend(user_id, block) {
        return this.sendApi('unsafe.friend.remove', { user_id })
    }

    async sendGroupMsg(group_id, msg) {
        const { content, log } = await this.msgToContent(msg)
        logger.info(`${logger.blue(`[${this.uin} => ${group_id}]`)} 发送群消息：${log}`)
        const result = (await this.sendApi('message.create', {
            channel_id: group_id,
            content
        })).pop()
        return {
            message_id: `${group_id}-${result.id}`
        }
    }

    async sendPrivateMsg(user_id, msg) {
        const { content, log } = await this.msgToContent(msg)
        logger.info(`${logger.blue(`[${this.uin} => ${user_id}]`)} 发送好友消息：${log}`)
        const result = (await this.sendApi('message.create', {
            channel_id: `private:${user_id}`,
            content
        })).pop()
        return {
            message_id: `private:${user_id}-${result.id}`
        }
    }

    /**
     * @param guild_id 群id
     * @param user_id 被禁言的用户id
     * @param duration 禁言时长（毫秒），默认10分钟
     */
    mute(guild_id, user_id, duration = 600000) {
        return this.sendApi('guild.member.mute', {
            channel_id: guild_id,
            user_id: String(user_id),
            duration: duration
        })
    }

    setGroupKick(guild_id, user_id, permanent) {
        return this.sendApi('guild.member.kick', {
            channel_id: guild_id,
            user_id: String(user_id),
            permanent: permanent
        })
    }

    setGroupLeave(guild_id) {
        return this.sendApi('unsafe.guild.remove', { guild_id })
    }

    poke(channel_id, user_id) {
        const content = user_id ? `<chronocat:poke user-id="${user_id}"/>` : `<chronocat:poke />`
        let result = this.sendApi('message.create', {
            channel_id: channel_id,
            content
        })
        if (!Array.isArray(result)) {
            result = [result]
        }
        const poppedResult = result.pop()
        return {
            message_id: `${channel_id}-${poppedResult.id}`
        }
    }

    async getFriendList() {
        const friend_list = await this.sendApi('friend.list', { next: '' })
        for (const i of friend_list.data) {
            // bug: login.get没有name
            if (i.id == this.self_id) {
                this.nickname = i.name
            }
            this.fl.set(i.id, {
                ...i,
                bot_id: this.self_id,
                user_id: i.id,
                nickname: i.name,
                remark: i.nick
            })
        }
        return this.fl
    }

    async getGroupList() {
        const group_list = await this.sendApi('guild.list', { next: '' })
        for (const i of group_list.data) {
            this.gl.set(i.id, {
                ...i,
                bot_id: this.self_id,
                group_id: i.id,
                group_name: i.name,
            })
        }
        return this.gl
    }

    deleteMsg(id) {
        const [channel_id, message_id] = id.split('-')
        return this.sendApi('message.delete', { channel_id, message_id })
    }

    async makeBot(data, bot) {
        Bot[data.self_id] = bot
        if (!Bot.uin.includes(data.self_id))
            Bot.uin.push(data.self_id)
        const info = await bot.sendApi('login.get')
        bot.info = {
            ...info,
            ...info.user,
            uin: info.self_id,
            user_id: info.self_id,
            nickname: info.user.name
        }
        this.platform = info.platform
        this.self_id = info.self_id
        this.uin = info.self_id
        this.avatar = info.user.avatar

        this.getGroupList()
        this.getFriendList()

        logger.mark(`${logger.blue(`[${data.self_id}]`)} ${this.name}(${this.id}) ${bot.version.version} 已连接`)
        Bot.em(`connect.${data.self_id}`, data)
    }

    async makeMessage(data, bot) {
        let event, e = {
            bot,
            adapter: bot.adapter,
            user_id: data.user.id,
            nickname: data.user.name,
            self_id: data.self_id
        }
        switch (data.type) {
            // 收到消息
            case 'message-created':
                e.post_type = 'message'
                e.sender = {
                    user_id: data.user.id,
                    nickname: data.user.name,
                }
                e.message_id = data.message.id
                e.message = await this.contentToMsg(data.message.content)
                e.raw_message = data.message.content
                if (e.message.length == 0) {
                    return
                }
                if (e.message.some(i => i.type === 'chronocat:poke')) {
                    e.sub_type = 'poke'
                } else {
                    if (data.channel.type == 0) {
                        e.message_type = 'group'
                        e.sub_type = 'normal'
                        e.group_name = data.guild.name
                        e.group_id = data.guild.id
                        logger.info(`${logger.blue(`[${e.self_id}]`)} 群消息：[${e.group_name}(${e.group_id}), ${e.nickname}(${e.user_id})] ${e.raw_message}`)
                    } else {
                        e.message_type = 'private'
                        e.sub_type = 'friend'
                        logger.info(`${logger.blue(`[${e.self_id}]`)} 好友消息：[${e.nickname}(${e.user_id})] ${e.raw_message}`)
                    }
                    event = `${e.post_type}.${e.message_type}.${e.sub_type}`
                    break;
                }
            // 解除禁言
            case 'unsafe-guild-unmute':
                e.duration = 0
            // 群禁言
            case 'unsafe-guild-mute':
                e.sub_type ||= 'ban'
            // 群员增加
            case 'guild-member-added':
                e.post_type = 'notice'
                e.notice_type = 'group'
                e.sub_type ||= 'increase';
                e.nickname = data.user.name
                e.group_id = data.guild.id
                event = `${e.post_type}.${e.notice_type}.${e.sub_type}`
                break
            // 新增群员
            case 'guild-member-added':
                // {
                //     id: number,
                //     type: 'guild-member-added',
                //     platform: string,
                //     self_id: string,
                //     timestamp: number,
                //     user: {
                //       name: string,
                //       avatar: string
                //     },
                //     channel: { type: number, id: string, name: string },
                //     guild: {
                //       id: string,
                //       name: string,
                //       avatar: string
                //     },
                //     member: {},
                //     message: { id: string, content: string },
                //     operator: {}
                //   }
                break
            default:
                break
        }
        event && Bot.em(event, e)
    }

    makeEvents(data, bot) {
        try {
            data = JSON.parse(data)
        } catch (error) {
            logger.error(`数据解码失败`, data)
        }
        switch (data.op) {
            case 0:
                this.makeMessage(data.body, bot)
                break
            case 2:
                break
            case 4:
                this.makeBot(data.body.logins[0], bot)
                break
            default:
                break
        }
    }

    async contentToMsg(content) {
        const root = parse(content, { blockTextElements: { script: false, style: false, pre: false } });
        const msg = []
        for (const i of root.childNodes) {
            const data = {}
            if (i.rawTagName) {
                for (const attr of i.rawAttrs.split(' ')) {
                    let [key, value] = attr.split('=')
                    data[key] = value?.replace(/"/g, '')
                }
            } else {
                data.type = 'text'
                data.text = i.rawText
            }
            // for (const c of i.childNodes) {
            //     data.child.push(...await this.contentToMsg(c))
            // }
            switch (data.type) {
                case 'img':
                    data.type = 'image'
                    switch (config.img) {
                        case 'raw':
                            data.url = data.src
                            break;
                        case 'md5':
                            data.url = `https://gchat.qpic.cn/gchatpic_new/0/0-0-${await this.getImageMD5(data.src)}/0`
                            break
                        default:
                            data.url = data.src
                            break;
                    }
                    break;
                case 'text':
                    break
                case 'at':
                    data.qq = data.id
                    break
                case 'chronocat:poke':
                    break
                // case 'quote':
                //     break
                // case 'audio':
                //     data.type = 'record'
                //     break
                // case 'video':
                //     break
                // case 'chronocat:face':
                //     data.type = 'face'
                //     break
                default:
                    continue
            }
            msg.push(data)
        }
        return msg
    }

    async msgToContent(msg) {
        if (!Array.isArray(msg)) msg = [msg]
        let content = '', log = ''
        for (let i of msg) {
            if (typeof i != 'object') i = { type: 'text', text: i }
            switch (i.type) {
                case 'reply':
                    content += `<quote id="${i.id}"/>`
                    break
                case 'text':
                    content += i.text
                    log += i.text
                    break
                case 'at':
                    if (i.qq == 'all') {
                        content += `<at type="all"/>`
                    } else {
                        content += `<at id="${i.qq}"/>`
                    }
                    log += `@${i.qq}`
                    break
                case 'image':
                    content += `<img src="${this.getImageContent(i.file)}"/>`
                    log += '[图片]'
                    break
                case 'record':
                    content += `<audio src="${await this.getRecordContent(i.file)}"/>`
                    log += '[语音]'
                    break
                case 'face':
                    //发送qq表情 格式： e.reply({ type: 'face', id: 11 })
                    content += `<chronocat:face id="${i.id}">`
                    break
                case 'node':
                    switch (config.node) {
                        case 2:
                            for (const { message, user_id, nickname } of i.data) {
                                const { content: c, log: l } = await this.msgToContent(message)
                                content += `<message>${c}</message>`
                                log += l
                            }
                            break
                        case 3:
                            if (Handler.has('ws.tool.toImg')) {
                                const e = {
                                    reply: (msg) => {
                                        content += `<img src="${this.getImageContent(msg.file)}"/>`
                                        log += '[图片]'
                                    },
                                    user_id: this.self_id,
                                    nickname: this.nickname
                                }
                                e.runtime = new Runtime(e)
                                await Handler.call('ws.tool.toImg', e, i.data)
                                break
                            }
                        default:
                            content += '<message>'
                            for (const { message, user_id, nickname } of i.data) {
                                const { content: c, log: l } = await this.msgToContent(message)
                                content += `<author id="${user_id || this.self_id} name="${this.nickname}">${c}<author/><br/>`
                                log += l
                            }
                            content += '</message>'
                            break
                    }
                    break
                default:
                    break
            }
        }
        return { content, log }
    }

    async getImageMD5(url) {
        const buffer = Buffer.from(await (await fetch(url)).arrayBuffer())
        const hash = createHash('md5');
        hash.update(buffer);
        return hash.digest('hex').toUpperCase()
    }

    getImageContent(data) {
        let buffer, contentType = 'image/png', content
        if (Buffer.isBuffer(data)) {
            buffer = data
        } else if (data.match(/^base64:\/\//)) {
            buffer = Buffer.from(data.replace(/^base64:\/\//, ""), 'base64')
        } else if (data.match(/^(http|file:\/\/)/)) {
            content = data
        } else {
            try {
                buffer = fs.readFileSync(data)
                contentType = mimeTypes[extname(data)]
            } catch (error) {
                buffer = Buffer.from(data, 'base64')
                contentType = 'image/png'
            }
        }
        if (buffer) {
            return `data:${contentType};base64,${buffer.toString('base64')}`
        }
        return content
    }

    async getRecordContent(data) {
        let buffer
        const inputFile = join('temp', randomUUID())
        const pcmFile = join('temp', randomUUID())

        try {
            fs.writeFileSync(inputFile, await Bot.Buffer(data))
            await Bot.exec(`ffmpeg -i "${inputFile}" -f s16le -ar 48000 -ac 1 "${pcmFile}"`)
            buffer = Buffer.from((await encodeSilk(fs.readFileSync(pcmFile), 48000)).data)
        } catch (err) {
            logger.error(`silk 转码错误：${err}`)
        }

        for (const i of [inputFile, pcmFile]) {
            try {
                fs.unlinkSync(i)
            } catch (err) { }
        }

        if (buffer) return `data:application/octet-stream;base64,${buffer.toString('base64')}`
    }
}

const adapter = new class Adapter {
    constructor() {
        this.id = "QQ"
        this.name = 'satori'
    }

    async connect(data) {
        const [host, port, token] = data.split(':')
        const bot = new SatoriBot(host, port, token)
        try {
            const [name, version] = (await fetch(`http://${host}:${port}`)).headers.get('server').split('/')
            bot.version = {
                id: this.id,
                name: this.name,
                version
            }
        } catch (error) {
            logger.error(error)
            return false
        }
        bot.ws = new WebSocket(`http://${host}:${port}/v1/events`)
        bot.ws.on('open', () => {
            bot.sendWs(3, { token })
            setInterval(() => {
                bot.sendWs(1)
            }, 10 * 1000)
        })
        bot.ws.on('message', events => bot.makeEvents(events, bot))
        bot.ws.on('close', () => { })
        return true
    }

    async load() {
        for (const token of config.token) {
            await new Promise(resolve => {
                adapter.connect(token).then(resolve)
                setTimeout(resolve, 5000)
            })
        }
    }
}()

Bot.adapter.push(adapter)

export class SatoriAdapter extends plugin {
    constructor() {
        super({
            name: 'SatoriAdapter',
            dsc: 'Satori 适配器设置',
            event: 'message',
            rule: [
                {
                    reg: /^#Satori设置.+:.+:.+$/i,
                    fnc: 'Token',
                    permission: 'master'
                },
            ]
        })
    }

    async Token() {
        const token = this.e.msg.replace(/^#Satori设置/i, '').trim()
        if (config.token.includes(token)) {
            config.token = config.token.filter(item => item != token)
            this.reply(`账号已删除，重启后生效，共${config.token.length}个账号`, true)
        } else {
            if (await adapter.connect(token)) {
                config.token.push(token)
                this.reply(`账号已连接，共${config.token.length}个账号`, true)
            } else {
                this.reply('账号连接失败', true)
                return false
            }
        }
        await configSave()
    }
}

logger.info(logger.green('- Satori 适配器插件 加载完成'))
