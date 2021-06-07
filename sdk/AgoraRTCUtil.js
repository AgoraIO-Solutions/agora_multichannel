var AgoraRTCUtils = (function () {


  // Auto Adjust Resolutions

  // This utility will adjust the camera encoding profile dynamically in order to adapt to slower networks 
  // and also to support devices which insufficient CPU/GPU resources required to encode and decode higher resolution video streams
  // This utility is intended mainly for iOS devices where both Safari and Chrome do not automatically 
  // lower the encoding resolution when the outgoing bitrate is reduced or the encoder is stuggling to reach the desired FPS

  // It is useful on other browsers as well to avoid the bit rate dropping too low too quickly in the presence of packet loss.

  /* To use this module, simply include this JS file e.g.
     <script src="./sdk/AgoraRTCUtil.js"></script>

     and call the following after client.publish(..)

     AgoraRTCUtils.startAutoAdjustResolution(this.clients[this.myPublishClient],"360p_11");
  
     It is recommended that you start with the following settings in your app which correspond to the 360p_11 profile from the list below
     
          [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
          { microphoneId: this.micId }, { cameraId: this.cameraId, encoderConfig: { width:640, height: 360, frameRate: 24, bitrateMin: 400, bitrateMax: 1000} });
  
    To avoid losing the camera feed on iOS when switching resolution you should explicity select the camera and mic in the SDK e.g.
        await agoraApp.localTracks.videoTrack.setDevice(currentCam.deviceId);
        await agoraApp.localTracks.audioTrack.setDevice(currentMic.deviceId);
    
*/
  var AdjustFrequency = 500; // ms between checks
  var ResultCountToStepUp = 6; // number of consecutive positive results before step up occurrs
  var ResultCountToStepDown = 10; // number of consecutive negative results before step down occurrs
  var MinFPSPercent = 90; // below this percentage FPS will a trigger step down
  var MinVideoKbps = 100; // below this and the video is likely off or static 

  var _autoAdjustInterval;
  var _publishClient;
  var _currentProfile = 0;
  var _fpsLowObserved = 0;
  var _brLowObserved = 0;
  var _maxProfileDueToLowFPS = 1000;
  var _brHighObserved = 0;

  var _outboundVideoStats={
    profile : "",
    sendBitratekbps :0,
    brLowObserved: 0,
    fpsLowObserved: 0,
    sendFrameRate : 0
  };


  var _profiles = [
    // 180p for mobile only, putting frameRate 15 here doesn't seem to stick
    { id: "180p", width: 320, height: 180, frameRate: 24, bitrateMin: 150,  moveDownThreshold: 120, moveUpThreshold: 40, bitrateMax: 500 }, 
    { id: "360p_low", width: 640, height: 360, frameRate: 24, bitrateMin: 120, moveDownThreshold: 120, moveUpThreshold: 600, bitrateMax: 1000 },
    { id: "360p_11", width: 640, height: 360, frameRate: 24, bitrateMin: 400, moveDownThreshold: 250, moveUpThreshold: 650, bitrateMax: 1000 },
   // { id: "720p", width: 1280, height: 720, frameRate: 24, bitrateMin: 600, moveDownThreshold: 650, moveUpThreshold: 1200, bitrateMax: 1800 },
    //  { id: "1080p", width: 1920, height: 1080, frameRate: 24, bitrateMin: 600, bitrateMinDesired: 1200, bitrateMax: 3600 },
  ];

  // private methods
  function isIOS() {
    return (/iPhone|iPad|iPod/i.test(navigator.userAgent))
  }

  function getProfileIndex(profile) {
    for (var i = 0; i < _profiles.length; i++) {
      if (_profiles[i].id === profile) {
        return i;
      }
    }
    return -1;
  }

  function autoAdjustResolution() {
    // real time video stats
    videoStats = _publishClient.getLocalVideoStats();

    var profile = _profiles[_currentProfile];
    var sendBitratekbps = Math.floor(videoStats.sendBitrate / 1000);

    // check encoding FPS not too low
    if (videoStats.sendFrameRate && videoStats.sendFrameRate > 0 && videoStats.sendFrameRate < (profile.frameRate * MinFPSPercent / 100)) {
      _fpsLowObserved++;
    } else {
      _fpsLowObserved = 0;
    }

    // check outbound bitrate not too low for this resolution
    if (videoStats.sendResolutionWidth > 0 && sendBitratekbps < profile.moveDownThreshold && sendBitratekbps > MinVideoKbps) {
      _brLowObserved++;
    } else {
      _brLowObserved = 0;
    }

    // see if performing well enough to increase profile
    if (videoStats.sendResolutionWidth > 0 && (videoStats.sendResolutionWidth == profile.width || videoStats.sendResolutionWidth == profile.height) && sendBitratekbps > profile.moveUpThreshold) {
      _brHighObserved++;
    } else {
      _brHighObserved = 0;
    }

    // log details
    //console.log("AutoAdjustAlgo profile:"+_currentProfile+", width:"+videoStats.sendResolutionWidth+", height:"+videoStats.sendResolutionHeight+", fps:" + videoStats.sendFrameRate + ", br_kbps:" + sendBitratekbps + ", bad_fps:" + _fpsLowObserved + ", bad_br:" + _brLowObserved + ", good_br:" + _brHighObserved+" ios="+isIOS());
    // +", sendPacketsLost:"+videoStats.sendPacketsLost does not work on Safari

    // after 5 seconds of low bandwidth out
    if (_brLowObserved > ResultCountToStepDown) {
      changeProfile(_currentProfile - 1); // reduce profile
    }
    else if (_fpsLowObserved > ResultCountToStepDown) {
      _maxProfileDueToLowFPS = _currentProfile - 1; // do not return here
      changeProfile(_currentProfile - 1); // reduce profile
    }

    // after about 5 seconds of very good
    if (_fpsLowObserved == 0 && _brLowObserved == 0 && _currentProfile < _maxProfileDueToLowFPS && _brHighObserved > ResultCountToStepUp && _currentProfile < _profiles.length - 1) {
      changeProfile(_currentProfile + 1); // increase profile
    }

    _outboundVideoStats={
      profile : profile.id,
      sendBitratekbps : sendBitratekbps,
      brLowObserved: _brLowObserved,
      fpsLowObserved: _fpsLowObserved,
      sendFrameRate : videoStats.sendFrameRate
    };

    //AgoraRTCUtilEvents.emit("LocalVideoStatistics", _outboundVideoStats);
  }

  function changeProfile(profileInd) {
    if (profileInd < 0 || profileInd >= _profiles.length) {
      return;
    }
    _currentProfile = profileInd;
    _brLowObserved = 0;
    _brHighObserved = 0;
    _fpsLowObserved = 0;
    var profile = _profiles[profileInd];
    console.log("Auto Adjust Changing Profile to " + profile.id);
    if (_publishClient && _publishClient._highStream && _publishClient._highStream.videoTrack) {
      _publishClient._highStream.videoTrack.setEncoderConfiguration({ width: profile.width, height: profile.height, frameRate: profile.frameRate, bitrateMin: profile.bitrateMin, bitrateMax: profile.bitrateMax });
    }
  }

  // Fire Inbound Audio Levels for Remote Streams
  // Bandwidth and Call Stats Utils
  // fire events if necessary

  var _rtc_clients = [];
  var _rtc_num_clients = 0;
  var _monitorInboundAudioLevelsInterval;

  function monitorInboundAudioLevels() {

    for (var i = 0; i < _rtc_num_clients; i++) {
      var client = _rtc_clients[i];
      if (!client._users.length) {
        continue;
      }

      if (client._remoteStream) {
        for (var u = 0; u < client._users.length; u++) {
          var uid = client._users[u].uid;
          var rc = client._remoteStream.get(uid);
          if (rc) {
            if (rc.pc && rc.pc.pc) {
              rc.pc.pc.getStats(null).then(stats => {
                stats.forEach(report => {
                  if (report.type === "inbound-rtp" && report.kind === "audio") {
                    if (report["audioLevel"]) {
                      var audioLevel = report["audioLevel"];
                      if (audioLevel > 1.0) {
                        audioLevel = audioLevel / 100000.0
                      }
                      //console.log(" audioLevel " +audioLevel );
                      // Safari has much bigger numbers 
                      // need to divide by around 10000
                      AgoraRTCUtilEvents.emit("InboundAudioExceedsThreshold", audioLevel);
                    }

                    // Object.keys(report).forEach(statName => { console.log(`UTILS inbound-rtp ${report.kind} for ${uid} ${statName} ${report[statName]}`); });
                  } else {
                    // Object.keys(report).forEach(statName => { console.log(`${report.type} ${report.kind} ${uid}  ${statName}: ${report[statName]}`); });
                  }
                })
              });
            }
          }
        }
      }
    }
  }

  // Voice Activity Detection
  // fire events if necessary

  var _vad_audioTrack = null;
  var _voiceActivityDetectionFrequency = 150;

  var _vad_MaxAudioSamples = 400;
  var _vad_MaxBackgroundNoiseLevel = 30;
  var _vad_SilenceOffeset = 10;
  var _vad_audioSamplesArr = [];
  var _vad_audioSamplesArrSorted = [];
  var _vad_exceedCount = 0;
  var _vad_exceedCountThreshold = 2;
  var _vad_exceedCountThresholdLow = 1;
  var _voiceActivityDetectionInterval;

  function getInputLevel(track) {
    var analyser = track._source.analyserNode;
    const bufferLength = analyser.frequencyBinCount;
    var data = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(data);
    var values = 0;
    var average;
    var length = data.length;
    for (var i = 0; i < length; i++) {
      values += data[i];
    }
    average = Math.floor(values / length);
    return average;
  }

  function voiceActivityDetection() {
    if (!_vad_audioTrack || !_vad_audioTrack._enabled)
      return;

    var audioLevel = getInputLevel(_vad_audioTrack);
    if (audioLevel <= _vad_MaxBackgroundNoiseLevel) {
      if (_vad_audioSamplesArr.length >= _vad_MaxAudioSamples) {
        var removed = _vad_audioSamplesArr.shift();
        var removedIndex = _vad_audioSamplesArrSorted.indexOf(removed);
        if (removedIndex > -1) {
          _vad_audioSamplesArrSorted.splice(removedIndex, 1);
        }
      }
      _vad_audioSamplesArr.push(audioLevel);
      _vad_audioSamplesArrSorted.push(audioLevel);
      _vad_audioSamplesArrSorted.sort((a, b) => a - b);
    }
    var background = Math.floor(3 * _vad_audioSamplesArrSorted[Math.floor(_vad_audioSamplesArrSorted.length / 2)] / 2);
    if (audioLevel > background + _vad_SilenceOffeset) {
      _vad_exceedCount++;
    } else {
      _vad_exceedCount = 0;
    }

    if (_vad_exceedCount > _vad_exceedCountThresholdLow) {
      AgoraRTCUtilEvents.emit("VoiceActivityDetectedFast", _vad_exceedCount);
    }

    if (_vad_exceedCount > _vad_exceedCountThreshold) {
      AgoraRTCUtilEvents.emit("VoiceActivityDetected", _vad_exceedCount);
      _vad_exceedCount = 0;
    }


  }


  // Network Statistics
  // There are lots of remote streams
  // Consider NACK rate
  // Monitor Render Rate for being erratic 
  // fireevent when all collected

  var MaxRenderRateSamples=16; // 4 seconds
  var _monitorRemoteCallStatsInterval;
  var _userStatsMap={};
  var _clientStatsMap={};
  
 
  function calculateRenderRateVolatility(statsMap){

    var arr= statsMap.renderRates;

    if (arr.length >= MaxRenderRateSamples) {
      var removed = arr.shift();
    }
    arr.push(statsMap.renderFrameRate);

    var i,j,total = 0;
    for(i=0;i<arr.length;i+=1){
        total+=arr[i];
    }
    statsMap.renderRateMean = total/arr.length;
    var vol=0;
    for(j=0;j<arr.length;j+=1){
       vol+= Math.abs(arr[j]- statsMap.renderRateMean);
    }
    statsMap.renderRateStdDeviation=vol/arr.length;
    statsMap.renderRateStdDeviationPerc=(statsMap.renderRateStdDeviation/statsMap.renderRateMean)*100
   
  }

  async function monitorRemoteCallStats() {

    // store previous values for each rU
    // look for a volatile render rate 
    // emit results at end of rU list 
    _clientStatsMap={
      UserCount : 0,
      RecvBitrate : 0,
      SendBitrate : 0,
      MaxOutgoingAvailableBandwidth : 0,
      MaxRTT : 0,
      SumRxRVol: 0,
      SumRxNR: 0,
      SumRxAggRes: 0,
      AvgRxRVol: 0,
      AvgRxNR: 0,
      TxProfile : "",
      TxSendBitratekbps :0,
      TxBrLowObserved: 0,
      TxFpsLowObserved: 0,
      TxSendFrameRate : 0
    };


    for (var i = 0; i < _rtc_num_clients; i++) {
      var client = _rtc_clients[i];
      if (!client._users.length) {
        continue;
      }

      if (client._remoteStream) {
        for (var u = 0; u < client._users.length; u++) {
          var uid = client._users[u].uid;
          var rc = client._remoteStream.get(uid);
          if (rc) {
            if (rc.pc && rc.pc.pc) {

              // check each remote user has last stats map
              if (!_userStatsMap[uid]){
                _userStatsMap[uid]={
                  uid : uid,
                  lastStatsRead : 0,
                  lastNack : 0,
                  nackRate : 0,
                  lastPacketsRecvd: 0,
                  renderFrameRate: 0,
                  renderRateMean: 0,
                  renderRateStdDeviation: 0,
                  renderRateStdDeviationPerc: 0,
                  receiveResolutionWidth: 0,
                  receiveResolutionHeight: 0,
                  receiveBitrate: 0,
                  renderRates: []
                };
              }

              await rc.pc.pc.getStats(null).then(async stats => {
                await stats.forEach(report => {

                  if (report.type === "inbound-rtp" && report.kind === "video") {
                    var now = Date.now();
                    var nack = report["nackCount"];
                    var packetsReceived = report["packetsReceived"];
                    var nackChange = (nack -  _userStatsMap[uid].lastNack);
                    var packetChange = (packetsReceived -  _userStatsMap[uid].lastPacketsRecvd);
                    var timeDiff = now -  _userStatsMap[uid].lastStatsRead;
                    var nackRate = Math.floor((nackChange / packetChange) * (timeDiff / 10));
                    _userStatsMap[uid].lastStatsRead = now;
                    _userStatsMap[uid].lastNack = nack;
                    _userStatsMap[uid].nackRate = nackRate;
                    _userStatsMap[uid].lastPacketsRecvd = packetsReceived;
                   // console.log(uid+" nackRate "+nackRate);
                   }
                })
              });

              const remoteTracksStats = { video: client.getRemoteVideoStats()[uid], audio: client.getRemoteAudioStats()[uid] };

              _userStatsMap[uid].renderFrameRate=Number(remoteTracksStats.video.renderFrameRate);
              _userStatsMap[uid].receiveResolutionWidth=Number(remoteTracksStats.video.receiveResolutionWidth).toFixed(0);
              _userStatsMap[uid].receiveResolutionHeight=Number(remoteTracksStats.video.receiveResolutionHeight).toFixed(0);
              _userStatsMap[uid].receiveBitrate=Number(remoteTracksStats.video.receiveBitrate/1000).toFixed(0);              
              _userStatsMap[uid].totalDuration=Number(remoteTracksStats.video.totalDuration).toFixed(0);

              if ( _userStatsMap[uid].renderFrameRate > 0 ) {
                calculateRenderRateVolatility(_userStatsMap[uid]);
              }

              // emit user
              AgoraRTCUtilEvents.emit("RemoteVideoStatistics", _userStatsMap[uid]);

              _clientStatsMap.SumRxRVol=_clientStatsMap.SumRxRVol+_userStatsMap[uid].renderRateStdDeviationPerc;
              _clientStatsMap.SumRxNR=_clientStatsMap.SumRxNR+_userStatsMap[uid].nackRate;
              _clientStatsMap.UserCount=_clientStatsMap.UserCount + 1;

              _clientStatsMap.SumRxAggRes= _clientStatsMap.SumRxAggRes+(remoteTracksStats.video.receiveResolutionWidth*remoteTracksStats.video.receiveResolutionHeight)
              // calculate combined stats \\ 
              
              // avg nackRate

              // avg rrVol

              // min/max/avg nackRate, rrVol

              // outliers 

              // does nackRate always increase when rrVol does?
              
              // does rrVol increase when nackRate does?

              // does rrVol increase if remote uplink packet loss present?

              // does nackRate increase if remote has upload packet loss?

              // do we want to unsubsribe completely in the case of just a few streamas

              // if increased nackRate is due to my connection it will be seen for all remotes
              
              // do we want to reduce outgoing fps if lots of remote RV? Ensure outgoing FPS good by limiting RVs also
            
/*
            If all Rr vol > 10 then local CPU uissue

            network limits bitrate (TxBr and RxBr)
            cpu/gpu limits area of video to encode or decode (TxArea, RxArea)

            switching between high/low/no streams changes RxBr and RxArea 
            switching between profile/no camera changes  TxBr and TxArea

            All 

            It is possible to get individual high RxRVol if remote fps is volatile due to CPU issues
            but if all clients ensure they produce constant fps by reducing the encoding profile or switching off cam if necessary then that is less likely
            When there is a local CPU issue then all RxRVol will be > 10 and RxArea should be reduced
            When there is local downlink issue all RxNR will be > 5 and RxBr

            AvgRxRVol * AvgRxNR will determine what the Total RxBr and RxArea should do (increase/decrease/hold)

*/


            }
          }
        }

        // channel (client) level stats
        const clientStats = client.getRTCStats();

        _clientStatsMap.RecvBitrate=_clientStatsMap.RecvBitrate+clientStats.RecvBitrate;
        _clientStatsMap.SendBitrate=_clientStatsMap.SendBitrate+clientStats.SendBitrate;

        if ( clientStats.OutgoingAvailableBandwidth>_clientStatsMap.MaxOutgoingAvailableBandwidth ) {
          _clientStatsMap.MaxOutgoingAvailableBandwidth=clientStats.OutgoingAvailableBandwidth;  
        }

        if ( clientStats.RTT>_clientStatsMap.MaxRTT ) {
          _clientStatsMap.MaxRTT=clientStats.RTT;  
        }


        if (client._highStream) {

          var   outgoingStats = client.getLocalVideoStats();

          _clientStatsMap.TxSendBitratekbps=Math.floor(outgoingStats.sendBitrate / 1000);
          _clientStatsMap.TxSendFrameRate=outgoingStats.sendFrameRate;
          _clientStatsMap.TxSendResolutionWidth=outgoingStats.sendResolutionWidth;
          _clientStatsMap.TxSendResolutionHeight=outgoingStats.sendResolutionHeight;

        }

      


      }
    }
    // calculate aggregate user stats and aggregate channel (client) stats

    _clientStatsMap.AvgRxRVol=_clientStatsMap.SumRxRVol/_clientStatsMap.UserCount;
    _clientStatsMap.AvgRxNR=_clientStatsMap.SumRxNR/_clientStatsMap.UserCount;

    // will only be set if monitor outbound running
    _clientStatsMap.TxProfile=_outboundVideoStats.profile;
    _clientStatsMap.TxBrLowObserved=_outboundVideoStats.brLowObserved;
    _clientStatsMap.TxFpsLowObserved=_outboundVideoStats.fpsLowObserved;


    AgoraRTCUtilEvents.emit("ClientVideoStatistics",_clientStatsMap);
  }


  // End Network Statistics


  return { // public interfaces
    startAutoAdjustResolution: function (client, initialProfile) {
      _publishClient = client;
      _currentProfile = getProfileIndex(initialProfile);
      if (_currentProfile < 0)
        throw 'Auto Adjust Profile Not Found';
      _autoAdjustInterval = setInterval(() => {
        autoAdjustResolution();
      }, AdjustFrequency);
    },
    stopAutoAdjustResolution: function () {
      clearInterval(_autoAdjustInterval);
    },
    changeUp: function () {
      changeProfile(_currentProfile + 1); // increase profile
    },
    changeDown: function () {
      changeProfile(_currentProfile - 1); // reduce profile
    },
    isIOS: function () {
      return isIOS();
    },
    setRTCClients: function (clientArray, numClients) {
      _rtc_clients = clientArray;
      _rtc_num_clients = numClients;
    },
    setRTCClient: function (client) {
      _rtc_clients[0] = client;
      _rtc_num_clients = 1;
    },
    startInboundVolumeMonitor: function (inboundVolumeMonitorFrequency) {
      _monitorInboundAudioLevelsInterval = setInterval(() => {
        monitorInboundAudioLevels();
      }, inboundVolumeMonitorFrequency);
    },
    stopInboundVolumeMonitor: function () {
      clearInterval(_monitorInboundAudioLevelsInterval);
      _monitorInboundAudioLevelsInterval = null;
    },

    startVoiceActivityDetection: function (vad_audioTrack) {
      _vad_audioTrack = vad_audioTrack;
      if (_voiceActivityDetectionInterval) {
        return;
      }
      _voiceActivityDetectionInterval = setInterval(() => {
        voiceActivityDetection();
      }, _voiceActivityDetectionFrequency);
    },
    stopVoiceActivityDetection: function () {
      clearInterval(_voiceActivityDetectionInterval);
      _voiceActivityDetectionInterval = null;
    },
    startRemoteCallStatsMonitor: function (remoteCallStatsMonitorFrequency) {
      _monitorRemoteCallStatsInterval = setInterval(() => {
        monitorRemoteCallStats();
      }, remoteCallStatsMonitorFrequency);
    },
    stopRemoteCallStatsMonitor: function () {
      clearInterval(_monitorRemoteCallStatsInterval);
      _monitorRemoteCallStatsInterval = null;
    },


  };
})();



var AgoraRTCUtilEvents = (function () {

  var events = {};

  function on(eventName, fn) {
    events[eventName] = events[eventName] || [];
    events[eventName].push(fn);
  }

  function off(eventName, fn) {
    if (events[eventName]) {
      for (var i = 0; i < events[eventName].length; i++) {
        if (events[eventName][i] === fn) {
          events[eventName].splice(i, 1);
          break;
        }
      }
    }
  }

  function emit(eventName, data) {
    if (events[eventName]) {
      events[eventName].forEach(function (fn) {
        fn(data);
      });
    }
  }

  return {
    on: on,
    off: off,
    emit: emit
  };

})();