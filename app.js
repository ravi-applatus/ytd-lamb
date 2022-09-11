const responseBuilder = require("aws-lambda-response-builder")
const ytdl = require("ytdl-core")
const fs = require('fs')
const AWS = require('aws-sdk')
const { accessKeyId, secretAccessKey, bucket } = process.env
const S3 = new AWS.S3({
    s3ForcePathStyle: true,
    accessKeyId,
    secretAccessKey
})
const { Buffer } = require('node:buffer')

async function generateVideo(url, title) {
    return await new Promise(async (resolve) => {
        const dir = `/tmp/videos/${title}.mp4`
        const S3Url = `https://${bucket}.s3.amazonaws.com/${encodeURIComponent(title).replaceAll('%20', '+')}.mp4`
        if(!fs.existsSync(`/tmp/videos/`)) fs.mkdirSync(`/tmp/videos/`)
        try {
            await new Promise((resolve, reject) => {
                fs.stat(dir, (err, stats) => {
                    console.log(err, stats)
                    if (stats)
                        return reject('file already exists')
                    return resolve('ok')
                })
            })
            
            try {
                await new Promise((resolve, reject) => {
                    S3.getObject({
                        Bucket: bucket,
                        Key: `${title}.mp4`
                    }, (err, data) => {
                        console.log(err, data)
                        if (err) resolve()
                        if (data) reject(S3Url) 
                    })
                })
            } catch(e) {
                throw new Error(e)
            }

            const writter = fs.createWriteStream(dir)
            const streamYtb = ytdl(url, { filter: 'videoandaudio' }).pipe(writter)
            await new Promise((resolve) => {
                streamYtb.on('finish', async () => {
                    const fileStream = fs.createReadStream(dir)
                    await new Promise((resolve) => {
                        S3.putObject({
                            Bucket: bucket,
                            Key: `${title}.mp4`,
                            Body: fileStream,
                            ContentType: 'video/mp4'
                        }, (err, data) => {
                            console.log(err, data)
                            resolve()
                        })
                    })
                    resolve()
                    fs.rmSync(dir)
                })
            })

            resolve(S3Url)
        } catch (err) {
            console.log(err)
            resolve(err.message)
        }
    })
}

exports.handler = async (event, context) => {
    console.log(event, context)
    let response = responseBuilder.buildApiGatewayOkResponse({ message: 'no video pass with ?v=youtube_link' })
    if (event.httpMethod === 'GET') {
        try {
            const videoLink = event.queryStringParameters?.v
            if (videoLink) {
                const isTrustedLink = ytdl.validateURL(videoLink)
                if (isTrustedLink) {
                    const data = await ytdl.getInfo(videoLink)
                    const title = data.videoDetails.title
                    const link = await generateVideo(videoLink, title)
                    response = responseBuilder.buildApiGatewayOkResponse({ message: link })
                    return response
                }
            }
            return response
        } catch(e) {
            console.log(e)
            return response
        }
    } else if (event.httpMethod === 'POST') {
        if (event?.body && event?.isBase64Encoded === true) {
            console.log('raw body ', event.body)
            let bodyContent = `${Buffer.from(event.body, 'base64').toString('utf8')}`
            console.log('body content ', bodyContent)
            bodyContent = new URLSearchParams(bodyContent)
            console.log('body params ', bodyContent)
            const videoLink = bodyContent.get('Body')
            console.log('video link ', videoLink)
            try {
                if (videoLink) {
                    const isTrustedLink = ytdl.validateURL(videoLink)
                    if (isTrustedLink) {
                        const data = await ytdl.getInfo(videoLink)
                        const title = data.videoDetails.title
                        const link = await generateVideo(videoLink, title)
                        response = responseBuilder.buildApiGatewayOkResponse({ message: link })
                        return response
                    }
                }
                return response
            } catch(e) {
                console.log(e)
                return response
            }
        }
    }

    return response
}