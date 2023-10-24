import { ChildProcess, spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-for-homebridge';
import {
  CameraController,
  CameraStreamingDelegate,
  HAP,
  Logging,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SRTPCryptoSuites,
  SnapshotRequest,
  SnapshotRequestCallback,
  StreamRequestCallback,
  StreamRequestTypes,
  StreamSessionIdentifier,
  StreamingRequest,
  VideoInfo,
} from 'homebridge';
import ip from 'ip';
import { CGDGarageDoor } from './CGDGarageDoor';


type SessionInfo = {
  address: string;

  videoPort: number;
  videoCryptoSuite: SRTPCryptoSuites;
  videoSRTP: Buffer;
  videoSSRC: number;
};


export class StreamingDelegate implements CameraStreamingDelegate {
  private ffmpegDebugOutput = false;

  private readonly hap: HAP;
  private readonly log: Logging;

  controller?: CameraController;

  pendingSessions: Record<string, SessionInfo> = {};
  ongoingSessions: Record<string, ChildProcess> = {};

  private cgdStreaming: CGDGarageDoor;

  constructor(log: Logging, hap: HAP, cgdStreaming: CGDGarageDoor) {
    this.log = log;
    this.hap = hap;

    this.cgdStreaming = cgdStreaming;
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    this.log.debug(`Received request for snapshot at ${request.width}x${request.height}...`);
    const ffmpegCommand = '-f mjpeg -i pipe:0 -an -vframes 1 -preset ultrafast -f mjpeg -';
    const ffmpeg = spawn(ffmpegPath || 'ffmpeg', ffmpegCommand.split(' '), { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });

    let cgdStream;
    this.cgdStreaming.getStream().then((stream) => {
      cgdStream = stream;

      if (ffmpeg.killed) {
        return;
      }

      cgdStream.pipe(ffmpeg.stdin);
    });

    const snapshotBuffers: Buffer[] = [];

    ffmpeg.stdin.on('error', error => {
      this.log.error(`[Snapshot] Error sending data to stream: ${error.message}`);
    });

    ffmpeg.stdout.on('data', data => snapshotBuffers.push(data));

    ffmpeg.on('exit', (code, signal) => {
      if (cgdStream) {
        cgdStream.destroy();
      }

      if (signal) {
        this.log.error(`[Snapshot] Process was killed with signal: ${signal}`);
        callback(new Error('killed with signal ' + signal));
      } else if (code === 0) {
        this.log.debug(`Successfully captured snapshot at ${request.width}x${request.height}`);
        callback(undefined, Buffer.concat(snapshotBuffers));
      } else {
        this.log.error(`[Snapshot] Process exited with code ${code}`);
        callback(new Error('Snapshot process exited with code ' + code));
      }
    });
  }

  prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
    this.log.debug('Preparing stream...');

    const sessionId: StreamSessionIdentifier = request.sessionID;
    const targetAddress = request.targetAddress;

    const video = request.video;
    const videoPort = video.port;

    const videoCryptoSuite = video.srtpCryptoSuite;
    const videoSrtpKey = video.srtp_key;
    const videoSrtpSalt = video.srtp_salt;

    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: targetAddress,

      videoPort: videoPort,
      videoCryptoSuite: videoCryptoSuite,
      videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
      videoSSRC: videoSSRC,
    };

    const currentAddress = ip.address('public', request.addressVersion);

    const response: PrepareStreamResponse = {
      address: currentAddress,
      video: {
        port: videoPort,
        ssrc: videoSSRC,

        srtp_key: videoSrtpKey,
        srtp_salt: videoSrtpSalt,
      },
    };

    this.pendingSessions[sessionId] = sessionInfo;

    callback(undefined, response);
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    const sessionId = request.sessionID;

    switch (request.type) {
      case StreamRequestTypes.START: {
        this.log.debug(`Received start request for session: ${request.sessionID}...`);

        const sessionInfo = this.pendingSessions[sessionId];

        const video: VideoInfo = request.video;

        const width = video.width;
        const height = video.height;
        const fps = video.fps;

        const payloadType = video.pt;
        const maxBitrate = video.max_bit_rate;
        const mtu = video.mtu;

        const address = sessionInfo.address;
        const videoPort = sessionInfo.videoPort;
        const ssrc = sessionInfo.videoSSRC;
        const cryptoSuite = sessionInfo.videoCryptoSuite;
        const videoSRTP = sessionInfo.videoSRTP.toString('base64');

        this.log.debug(`Starting video stream (${width}x${height}, ${fps} fps, ${maxBitrate} kbps, ${mtu} mtu)...`);

        let videoffmpegCommand = '-f mjpeg -i pipe:0 -map 0:v ' +
          `-c:v libx264 -pix_fmt yuv420p -r ${fps} -preset ultrafast -tune zerolatency -g ${fps*2} -threads 0 ` +
          `-an -sn -dn -b:v ${maxBitrate}k -bufsize ${2 * maxBitrate}k -maxrate ${maxBitrate}k ` +
          `-payload_type ${payloadType} -ssrc ${ssrc} -f rtp `;

        if (cryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80) {
          videoffmpegCommand += `-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${videoSRTP} s`;
        }

        videoffmpegCommand += `rtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${mtu}`;

        if (this.ffmpegDebugOutput) {
          this.log.debug(`FFMPEG command: ffmpeg ${videoffmpegCommand}`);
        }

        const ffmpeg = spawn(ffmpegPath || 'ffmpeg', videoffmpegCommand.split(' '), {env: process.env});

        let cgdStream;
        this.cgdStreaming.getStream().then((stream) => {
          cgdStream = stream;

          if (ffmpeg.killed) {
            return;
          }

          cgdStream.pipe(ffmpeg.stdin);
        });

        ffmpeg.stdin.on('error', error => {
          this.log.error(`[Video] Error sending data to stream: ${error.message}`);
        });

        let started = false;
        ffmpeg.stderr.on('data', () => {
          if (!started) {
            started = true;

            callback();
          }
        });

        ffmpeg.on('error', error => {
          this.log.error(`[Video] Failed to start video stream: ${error.message}`);
          callback(new Error('ffmpeg process creation failed!'));
        });

        ffmpeg.on('exit', (code, signal) => {
          if (cgdStream) {
            cgdStream.destroy();
          }

          const message = '[Video] ffmpeg exited with code: ' + code + ' and signal: ' + signal;

          if (code === null || code === 255) {
            this.log.debug(`${message} (Video stream stopped!)`);
          } else {
            this.log.debug(`${message} (Error occurred!)`);

            if (!started) {
              this.log.error(`[Video] Failed to start video stream: ${message}`);
              callback(new Error(message));
            } else {
              this.controller!.forceStopStreamingSession(sessionId);
            }
          }
        });

        this.ongoingSessions[sessionId] = ffmpeg;
        delete this.pendingSessions[sessionId];

        break;
      }
      case StreamRequestTypes.RECONFIGURE: {
        this.log.debug(`Received (unsupported) request to reconfigure to: ${JSON.stringify(request.video)}`);
        callback();
        break;
      }
      case StreamRequestTypes.STOP: {
        const ffmpegProcess = this.ongoingSessions[sessionId];

        try {
          if (ffmpegProcess) {
            ffmpegProcess.kill('SIGKILL');
          }
        } catch (e) {
          this.log.error('Error occurred terminating the video process!');
        }

        delete this.ongoingSessions[sessionId];

        this.log.debug('Stopped streaming session!');
        callback();
        break;
      }
    }
  }
}
