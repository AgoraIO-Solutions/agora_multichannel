
## AgoraRTCUtils
This javascript module provides some useful algorithms to work with the AgoraRTC 4.x SDK
These utils are all used in this reference app and you can refer to [../app.js](../app.js) for more detail
Include the javascript:

       <script src="./sdk/AgoraRTCUtil.js"></script>

### Voice Activity Detection VAD
After publishing your microphone to the channel, call the startVoiceActivityDetection method.
You will receive callback events when voice is detected.

    AgoraRTCUtils.startVoiceActivityDetection(this.localTracks.audioTrack);
    AgoraRTCUtilEvents.on("VoiceActivityDetected",agoraApp.handleVADEvents);
   
This utility is detecting voice from the local microphone input.

You can then use Agora RTM (Realtime Messaging) to broadcast VAD message within the group.
For examples of this, see handleVADEvents() and handleRTM() in [../app.js](../app.js) .

### Inbound Remote Audio Levels
Be notified when the audioLevel on any remote stream exceeds zero

    AgoraRTCUtils.setRTCClient(this.client);
    AgoraRTCUtils.startInboundVolumeMonitor(100); // sampling interval
    
    
If using multi channel design you can pass client array and length like this

    AgoraRTCUtils.setRTCClients(this.clients,this.numClients);

### Auto Adjust Encoding Resolution
This utility will adjust the camera encoding profile dynamically in order to adapt to slower networks 
and also to support devices which insufficient CPU/GPU resources required to encode and decode higher resolution video streams.
This utility is recommended for iOS devices where both Safari and Chrome do not automatically 
lower the encoding resolution when the outgoing bitrate is reduced or the encoder is stuggling to reach the desired FPS

The algorithm can be useful on other platforms as well to avoid the bitrate dropping too low too quickly in the presence of packet loss 
but there may be a visible flicker when changing resolution. 


     AgoraRTCUtils.startAutoAdjustResolution(client,"360p_11");
  
It is recommended that you start with the following settings in your app which correspond to the 360p_11 profile from the list below
     
    [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
    { microphoneId: this.micId }, { cameraId: this.cameraId, encoderConfig: { width:640, height: 360, frameRate: 24, bitrateMin: 400, bitrateMax: 1000} });

To avoid losing the camera feed on iOS when switching resolution you should explicity select the camera and mic in the SDK e.g.
     
     await agoraApp.localTracks.videoTrack.setDevice(currentCam.deviceId);
     await agoraApp.localTracks.audioTrack.setDevice(currentMic.deviceId);
