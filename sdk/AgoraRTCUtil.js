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
  var ResultCountToStepDownFPS = 8; // number of consecutive negative results before step down occurrs
  var MinFPSPercent = 90; // below this percentage FPS will a trigger step down
  var MinVideoKbps = 100; // below this and the video is likely off or static 
  var MaxFPSSamples=8; // 4 seconds

  var _autoAdjustInterval;
  var _publishClient;
  var _currentProfile = 0;
  var _fpsLowObserved = 0;
  var _brLowObserved = 0;
  var _fpsVol=-1;
  var _maxProfileDueToLowFPS = 1000;
  var _brHighObserved = 0;
  var _remoteVideoPublisherCount=-1; 

  var _tempMaxProfile=null;
  var _increaseResolutionAt=0;
  var _switchForFPSAndBR=false;
  var _fpsRates=[];

  // if I am looking at remote user in content area and his resolution is below 360p_11
  // send request to increase resolution if possible to 360p_11
  // we dont want everyone in the room to have to keep requesting when it is standard speaker mode
  // its possible though that even when speaking all remotes have you small

  // we dont want to keep toggling

  // option 1: increase res when talking: no good because everyone might be in grid mode
  /*
    // option 2: send the current large person notification to that person every 3 seconds or if following speaker - until not speaking
  //           This person will drop back down if no request is received 
  
            if receiver is follow speaker and speaker is not >=360p then send him message telling him to stay high until speaking stops
            if receiver is manual viewer and remote not >=360p tell him to stay high while pings sent.
  */ 

  var _outboundVideoStats={
    profile : "",
    sendBitratekbps :0,
    brLowObserved: 0,
    fpsLowObserved: 0,
    fpsVol: 0,
    sendFrameRate : 0
  };

  var _profiles = [
  //  { id: "90p", width: 160, height: 90, frameRate: 24, bitrateMin: 100,  moveDownThreshold: 40, moveUpThreshold: 100, bitrateMax: 200, maxRemoteUsers: 100 }, 
    { id: "180p", width: 320, height: 180, frameRate: 24, bitrateMin: 150,  moveDownThreshold: 80, moveUpThreshold: 120, bitrateMax: 500, maxRemoteUsers: 16 }, 
    { id: "360p_low", width: 640, height: 360, frameRate: 24, bitrateMin: 120, moveDownThreshold: 120, moveUpThreshold: 600, bitrateMax: 1000, maxRemoteUsers: 4 },
    { id: "360p_11", width: 640, height: 360, frameRate: 24, bitrateMin: 400, moveDownThreshold: 250, moveUpThreshold: 650, bitrateMax: 1000, maxRemoteUsers: 4 },
    { id: "720p", width: 1280, height: 720, frameRate: 24, bitrateMin: 600, moveDownThreshold: 650, moveUpThreshold: 1200, bitrateMax: 1800, maxRemoteUsers: 1 },
    //  { id: "1080p", width: 1920, height: 1080, frameRate: 24, bitrateMin: 600, bitrateMinDesired: 1200, bitrateMax: 3600 },
  ];

  // private methods
  function isIOS() {
    return (/iPhone|iPad|iPod/i.test(navigator.userAgent));
  }

  function isMobile() {
    return (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
  }

  function getProfileIndex(profile) {
    for (var i = 0; i < _profiles.length; i++) {
      if (_profiles[i].id === profile) {
        return i;
      }
    }
    return -1;
  }

  function calculateOutboundFPSVolatility(fps){
  
    if (_fpsRates.length >= MaxFPSSamples) {
       _fpsRates.shift();
    }
    _fpsRates.push(fps);

    var i,j,total = 0;
    for(i=0;i<_fpsRates.length;i+=1){
        total+=_fpsRates[i];
    }
    var fpsMean = total/_fpsRates.length;
    var vol=0;
    for(j=0;j<_fpsRates.length;j+=1){
       vol+= Math.abs(_fpsRates[j]-fpsMean);
    }
    if (_fpsRates.length>=MaxFPSSamples){ // don't report vol on limited set
      var dev=vol/_fpsRates.length;
      return (dev/fpsMean)*100;
    }
    return 0
  }

  function autoAdjustResolution() {
    // real time video stats
    videoStats = _publishClient.getLocalVideoStats();

    var profile = _profiles[_currentProfile];
    var profileUp = null;
    if (_currentProfile<_profiles.length-1) {
      profileUp=_profiles[_currentProfile+1];
    }
    var sendBitratekbps = Math.floor(videoStats.sendBitrate / 1000);

    if (videoStats.sendFrameRate && videoStats.sendFrameRate > 0 ) {
      _fpsVol=calculateOutboundFPSVolatility(videoStats.sendFrameRate);
      //console.log(" calculateOutboundFPSVolatility "+fpsVol);
    }

    // check encoding FPS not too low
    if (_switchForFPSAndBR && videoStats.sendFrameRate && videoStats.sendFrameRate > 0 && (videoStats.sendFrameRate < (profile.frameRate * MinFPSPercent / 100) || _fpsVol>6.0 )) {
      _fpsLowObserved++;
    } else {
      _fpsLowObserved = 0;
    }

    // check outbound bitrate not too low for this resolution
    if (_switchForFPSAndBR && videoStats.sendResolutionWidth > 0 && sendBitratekbps < profile.moveDownThreshold && sendBitratekbps > MinVideoKbps) {
      _brLowObserved++;
    } else {
      _brLowObserved = 0;
    }

    // see if performing well enough to increase profile
    if (_switchForFPSAndBR && videoStats.sendResolutionWidth > 0 && (videoStats.sendResolutionWidth == profile.width || videoStats.sendResolutionWidth == profile.height) && sendBitratekbps > profile.moveUpThreshold) {
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
    else if (_fpsLowObserved > ResultCountToStepDownFPS) {
      _maxProfileDueToLowFPS = _currentProfile - 1; // do not return here
      changeProfile(_currentProfile - 1); // reduce profile
    } else if ((Date.now()-_increaseResolutionAt<6000) && _fpsLowObserved == 0 && _brLowObserved == 0 && _currentProfile < _maxProfileDueToLowFPS ) { // somebody requested large
      var desiredProfile=getProfileIndex("360p_11"); // increase if possible for someone to view now
      if (_currentProfile<desiredProfile) {
        changeProfile(desiredProfile); // increase if possible
      }  
    } else if (_remoteVideoPublisherCount>0 &&  profile.maxRemoteUsers < _remoteVideoPublisherCount) {
      // jump all the way
      changeProfile(_currentProfile - 1); // reduce profile          
    }  else if (_tempMaxProfile!=null && _currentProfile>_tempMaxProfile) {
      changeProfile(_tempMaxProfile); // reduce profile 
    } else if (!_tempMaxProfile &&  profileUp && (profileUp.maxRemoteUsers >= _remoteVideoPublisherCount) ) { // after about 5 seconds of very good and can handle that many users
      if (_fpsLowObserved == 0 && _brLowObserved == 0 && _currentProfile < _maxProfileDueToLowFPS && (_brHighObserved > ResultCountToStepUp || !_switchForFPSAndBR) && _currentProfile < _profiles.length - 1) {
        changeProfile(_currentProfile + 1); // increase profile
      }
    }

    _outboundVideoStats={
      profile : profile.id,
      sendBitratekbps : sendBitratekbps,
      brLowObserved: _brLowObserved,
      fpsVol: _fpsVol,
      fpsLowObserved: _fpsLowObserved,
      sendFrameRate : videoStats.sendFrameRate
    };

  }

  function changeProfile(profileInd) {
    if (profileInd < 0 || profileInd >= _profiles.length) {
      return;
    }


    _currentProfile = profileInd;
    var profile = _profiles[profileInd];

    _fpsLowObserved = 0;
    console.log("Auto Adjust Changing Profile to " + profile.id+" _brLowObserved="+_brLowObserved+" _brHighObserved="+_brHighObserved+" _fpsLowObserved="+_fpsLowObserved); 

    _brLowObserved = 0;
    _brHighObserved = 0;
    _fpsLowObserved = 0;

    _fpsRates = [];
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

  var MaxRenderRateSamples=8; // 4 or 8 seconds
  
  var _monitorRemoteCallStatsInterval;
  var _remoteCallStatsMonitorFrequency;
  var _userStatsMap={};
  var _clientStatsMap={};
  var _nackException=false;

  var _monitorStart=Date.now();
  var _monitorEnd=Date.now();


  const RemoteStatusGood=0;
  const RemoteStatusFair=1;
  const RemoteStatusPoor=2;
  const RemoteStatusCritical=3;

 var _clientStatsTrackMap={
    RemoteStatus: -1,
    RemoteStatusStart: 0,
    RemoteStatusDuration: 0,
  };
 
  function calculateRenderRateVolatility(statsMap){

    var arr= statsMap.renderRates;

    if (arr.length >= MaxRenderRateSamples) {
     arr.shift();
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
    if (arr.length>=MaxRenderRateSamples){ // don't report vol on limited set
      statsMap.renderRateStdDeviation=vol/arr.length;
      statsMap.renderRateStdDeviationPerc=(statsMap.renderRateStdDeviation/statsMap.renderRateMean)*100
     // console.log("rrvol "+statsMap.renderRateStdDeviationPerc+" "+arr); 
    }
   
  }

  async function monitorRemoteCallStats() {


    // store previous values for each rU
    // look for a volatile render rate 
    // emit results at end of rU list 
    // 500ms
    _clientStatsMap={
      RemoteSubCount : 0,
      RecvBitrate : 0,
      SendBitrate : 0,
      MaxOutgoingAvailableBandwidth : 0,
      MaxRTT : 0,
      SumRxRVol: 0,
      SumRxNR: 0,
      SumRxAggRes: 0,
      AvgRxRVol: 0,
      AvgRxNR: 0,
      SumRxDecodeTime: 0,
      AvgRxDecodeTime: 0,
      MinRemoteDuration : -1,
      RemoteStatusDuration: 0,
      RemoteStatus: 0,
      RemoteStatusExtra: 0,
      TxProfile : "",
      TxSendBitratekbps :0,
      TxBrLowObserved: 0,
      TxFpsLowObserved: 0,
      TxSendFrameRate : 0,
      LastUpdated : 0,
      LastEncodeTime : 0, 
      LastFramesEncoded : 0, 
      EncodeTime : 0,
      StatsRunTime : 0,
      StatsScheduleTime : 0
    };


    _monitorStart=Date.now();
    _clientStatsMap.StatsScheduleTime=_monitorStart-_monitorEnd;
    

    //console.log("stats schedule time  "+());


    for (var i = 0; i < _rtc_num_clients; i++) {
      var client = _rtc_clients[i];
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
                  lastDecodeTime: 0,
                  lastFramesDecoded: 0,
                  decodeTime : 0,
                  packetChange: 0,
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
                    var nackRate = 0;
                    if (packetChange>0 && nackChange>0 ) {
                      nackRate = Math.floor((nackChange / packetChange) * (timeDiff / 10));
                    }
                    var totalDecodeTime = report["totalDecodeTime"];
                    var framesDecoded = report["framesDecoded"];
                    var totalDecodeTimeChange = 1000*(totalDecodeTime - _userStatsMap[uid].lastDecodeTime);
                    var framesDecodedChange =  (framesDecoded -  _userStatsMap[uid].lastFramesDecoded);
                    var decodeTime=(totalDecodeTimeChange/framesDecodedChange);
                    if (decodeTime==0) {
                      decodeTime=0.01;
                    }

                    _userStatsMap[uid].lastStatsRead = now;
                    _userStatsMap[uid].lastNack = nack;            
                    _userStatsMap[uid].nackRate = nackRate;
                    _userStatsMap[uid].lastPacketsRecvd = packetsReceived;
                    _userStatsMap[uid].packetChange = packetChange;
                    _userStatsMap[uid].decodeTime = decodeTime;
                    if (framesDecodedChange>100) {
                      _userStatsMap[uid].lastDecodeTime=totalDecodeTime;
                      _userStatsMap[uid].lastFramesDecoded=framesDecoded;
                    }
                   }
                })
              });

              const remoteTracksStats = { video: client.getRemoteVideoStats()[uid], audio: client.getRemoteAudioStats()[uid] };

              _userStatsMap[uid].renderFrameRate=Number(remoteTracksStats.video.renderFrameRate);
              if (_userStatsMap[uid].receiveResolutionWidth!=Number(remoteTracksStats.video.receiveResolutionWidth).toFixed(0)){
                _userStatsMap[uid].renderRates=[]; // clear out array when res changes
              }
              _userStatsMap[uid].receiveResolutionWidth=Number(remoteTracksStats.video.receiveResolutionWidth).toFixed(0);
              _userStatsMap[uid].receiveResolutionHeight=Number(remoteTracksStats.video.receiveResolutionHeight).toFixed(0);
              _userStatsMap[uid].receiveBitrate=Number(remoteTracksStats.video.receiveBitrate/1000).toFixed(0);        
              if ( _userStatsMap[uid].packetChange>0) {      
                _userStatsMap[uid].totalDuration=Number(remoteTracksStats.video.totalDuration).toFixed(0);
              } else {
                _userStatsMap[uid].totalDuration=-1;
              }

              if ( _userStatsMap[uid].renderFrameRate > 0 ) {
                calculateRenderRateVolatility(_userStatsMap[uid]);
              }

              // emit user level stats
              AgoraRTCUtilEvents.emit("RemoteUserVideoStatistics", _userStatsMap[uid]);

              if ( _userStatsMap[uid].packetChange>0 &&  _userStatsMap[uid].totalDuration>5) // when people drop they remain for a while
              {
                _clientStatsMap.SumRxRVol=_clientStatsMap.SumRxRVol+_userStatsMap[uid].renderRateStdDeviationPerc;

                if (_userStatsMap[uid].renderRateStdDeviationPerc>10) {
                  console.log(uid+" "+_userStatsMap[uid].renderRates.length+" "+_userStatsMap[uid].renderRateStdDeviationPerc+" "+_userStatsMap[uid].renderRates);
                }
                
                if (_userStatsMap[uid].nackRate>0 && !isNaN(_userStatsMap[uid].nackRate)) {
                  _clientStatsMap.SumRxNR=_clientStatsMap.SumRxNR+_userStatsMap[uid].nackRate;
                }

                if (_userStatsMap[uid].decodeTime>0 && !isNaN(_userStatsMap[uid].decodeTime)) {
                  _clientStatsMap.SumRxDecodeTime=_clientStatsMap.SumRxDecodeTime+_userStatsMap[uid].decodeTime;
                }
                
                _clientStatsMap.RemoteSubCount=_clientStatsMap.RemoteSubCount + 1;
                _clientStatsMap.SumRxAggRes= _clientStatsMap.SumRxAggRes+(remoteTracksStats.video.receiveResolutionWidth*remoteTracksStats.video.receiveResolutionHeight)
              } 

              if (_userStatsMap[uid].totalDuration>-1 && (_clientStatsMap.MinRemoteDuration<0 || _userStatsMap[uid].totalDuration<_clientStatsMap.MinRemoteDuration)){
                _clientStatsMap.MinRemoteDuration=_userStatsMap[uid].totalDuration;
              }              

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
         // console.log("start monitorRemoteCallStats  outbound "+(Date.now()));
          var hrc=client._highStream;
          if (hrc.pc && hrc.pc.pc) {
            await hrc.pc.pc.getStats(null).then(async stats => {
              await stats.forEach(report => {
                if (report.type === "outbound-rtp" && report.kind === "video") {
                  var totalEncodeTime = report["totalEncodeTime"];
                  var framesEncoded = report["framesEncoded"];
                  var totalEncodeTimeChange = 1000*(totalEncodeTime - _clientStatsMap.LastEncodeTime);
                  var framesEncodedChange =  (framesEncoded -  _clientStatsMap.LastFramesEncoded);
                  _clientStatsMap.EncodeTime = (totalEncodeTimeChange/framesEncodedChange);
                  if (framesEncodedChange>100) {
                    _clientStatsMap.LastEncodeTime=totalEncodeTime;
                    _clientStatsMap.LastFramesEncoded=framesEncoded;
                     }
                  }
              })
            });
          }

          var outgoingStats = client.getLocalVideoStats();
          _clientStatsMap.TxSendBitratekbps=Math.floor(outgoingStats.sendBitrate / 1000);
          _clientStatsMap.TxSendFrameRate=outgoingStats.sendFrameRate;
          _clientStatsMap.TxSendResolutionWidth=outgoingStats.sendResolutionWidth;
          _clientStatsMap.TxSendResolutionHeight=outgoingStats.sendResolutionHeight;        
        }
      }
    }

    
    // calculate aggregate user stats and aggregate channel (client) stats

    // don't report render vol on one user as gateway interferes on its own in 2 person call
    //if (_clientStatsMap.RemoteSubCount>1) {
    _clientStatsMap.AvgRxRVol=_clientStatsMap.SumRxRVol/_clientStatsMap.RemoteSubCount;
    _clientStatsMap.AvgRxNR=_clientStatsMap.SumRxNR/_clientStatsMap.RemoteSubCount;
    _clientStatsMap.AvgRxDecodeTime=_clientStatsMap.SumRxDecodeTime/_clientStatsMap.RemoteSubCount;
    
   // } else {
   //   console.log(" _clientStatsMap.RemoteSubCount "+ _clientStatsMap.RemoteSubCount)
   //   _clientStatsMap.AvgRxRVol=-1;
   //   _clientStatsMap.AvgRxNR=-1;
   // }
    
   if ( !_clientStatsMap.TxSendResolutionWidth ) {
     _fpsVol=-2;
   }

   _monitorEnd=Date.now();
   _clientStatsMap.StatsRunTime=(_monitorEnd-_monitorStart);


    /// determine remote status, start and duration
    /// reset duration for good/critical/poor
    
    // render rate vol can be expected after recent high AvgRxNR
    // if nack rate goes high (critical)
    // then we can be more leanient about RRVol until RRVol has come back down
    if (_clientStatsMap.AvgRxRVol<6) {
      _nackException=false;
    }
    var rrMultiplier=1;
    if (_nackException) {
      rrMultiplier=2;
    }

    
    if (_clientStatsMap.AvgRxRVol > (12*rrMultiplier) ||  _clientStatsMap.AvgRxNR > 12 ||  _fpsVol>10.0 || _clientStatsMap.StatsRunTime > (50 + (10*_clientStatsMap.RemoteSubCount)) || _clientStatsMap.StatsScheduleTime > _remoteCallStatsMonitorFrequency*1.2 ) {
      // critical or poor
      if (_clientStatsTrackMap.RemoteStatus!=RemoteStatusPoor) {
        _clientStatsTrackMap.RemoteStatus=RemoteStatusPoor;
        _clientStatsTrackMap.RemoteStatusStart=Date.now();        
      } else {
        _clientStatsTrackMap.RemoteStatusDuration=Date.now()-_clientStatsTrackMap.RemoteStatusStart;        
      }

      if (_clientStatsMap.AvgRxRVol > (20*rrMultiplier) ||  _clientStatsMap.AvgRxNR > 30 ||  _fpsVol>20.0 || _clientStatsMap.StatsScheduleTime > _remoteCallStatsMonitorFrequency*1.1) {

        if ( _clientStatsMap.AvgRxNR > 30 ) {
          _nackException=true;
        }
        
        _clientStatsMap.RemoteStatusExtra=RemoteStatusCritical;
      } else {
        _clientStatsMap.RemoteStatusExtra=RemoteStatusPoor;
      }
    }  

    else if (_clientStatsMap.AvgRxRVol > (6*rrMultiplier) ||  _clientStatsMap.AvgRxNR > 4 || _fpsVol>3.0) {
      if (_clientStatsTrackMap.RemoteStatus!=RemoteStatusFair ) {
        _clientStatsTrackMap.RemoteStatus=RemoteStatusFair;
        _clientStatsTrackMap.RemoteStatusStart=Date.now();        
      } else {
        _clientStatsTrackMap.RemoteStatusDuration=Date.now()-_clientStatsTrackMap.RemoteStatusStart;
      }
    } else {
      if (_clientStatsTrackMap.RemoteStatus!=RemoteStatusGood ) {
        _clientStatsTrackMap.RemoteStatus=RemoteStatusGood;
        _clientStatsTrackMap.RemoteStatusStart=Date.now();        
      } else {
        _clientStatsTrackMap.RemoteStatusDuration=Date.now()-_clientStatsTrackMap.RemoteStatusStart;
      }
    }


    // will only be set if monitor outbound running
    _clientStatsMap.TxProfile=_outboundVideoStats.profile;
    _clientStatsMap.TxBrLowObserved=_outboundVideoStats.brLowObserved;
    _clientStatsMap.TxFpsLowObserved=_outboundVideoStats.fpsLowObserved;
    _clientStatsMap.TxFpsVol=_outboundVideoStats.fpsVol;
    

    _clientStatsMap.RemoteStatusDuration=Math.floor(_clientStatsTrackMap.RemoteStatusDuration/1000);
    _clientStatsMap.RemoteStatus= _clientStatsTrackMap.RemoteStatus;
    _clientStatsMap.LastUpdated= Date.now();

    AgoraRTCUtilEvents.emit("ClientVideoStatistics",_clientStatsMap);

    //console.log("stats process time  "+(_monitorEnd-_monitorStart));
    if ( _monitorRemoteCallStatsInterval) {
      setTimeout(() => {
        monitorRemoteCallStats();
      }, _remoteCallStatsMonitorFrequency);
  
    }
   // console.log("  ");

    /*
     Here we can fire events to advise whether remote streams should be reduced in quality or turned off
     It should be up to the calling application to decide how to achieve this because it may have specific priority of which video to keep 
     Or the calling app can provide required access to have this module manage the remote streams and outbound encoding profile 
     
     Subject overview
            A user's network limits bitrate throughput (TxBr and RxBr)
            A device's cpu/gpu limits area of video to encode or decode (TxArea, RxArea)

            switching between high/low/no streams changes RxBr and RxArea 
            switching between profile/no camera changes  TxBr and TxArea


            It is possible to get individual high RxRVol if remote fps is volatile due to CPU issues
            but if all clients ensure they produce constant fps by reducing the encoding profile or switching off cam if necessary then that is less likely
            When there is a local CPU issue then all RxRVol will be > 10 and RxArea should be reduced
            When there is a significant local downlink issue all RxNR will be > 5 and RxBr

            AvgRxRVol * AvgRxNR will determine what the Total RxBr and RxArea should do (increase/decrease/hold)
     
     Q: does nackRate always increase when rrVol does?
     A: No, I have observed high rrVol due to low CPU while nackRate can remain zero
    
     Q:does rrVol increase when nackRate does?
     A: to some degree yes. This might be nack related issue in VOSWEB 

     Q: does rrVol increase if remote uplink packet loss present?
     A: a small amount

     Q: does nackRate increase if remote has upload packet loss?
     A: yes, specific to this remote connection

     Q: do we want to unsubsribe completely in the case of just a few streams
    
     do we want to reduce outgoing resolution if lots of remote RV? Ensure outgoing FPS good by limiting RVs also
            
    */
/*

Implementation

CPU struggling 
Network struggling 
Experiments and observations
            If all Rr vol > 10 then local CPU uissue

            The events will be 

strategy
  Reducing the number of high streams (if any)

  Reducing the number of streams

  Reducing number of audio streams

  Needs time to settle, especially after call start


  Only do 720p if 2 people in the call
  autoAdjustResolution



  Observations

  Under congestion (insufficient network) the nack and RVol go super high, under this scenario the app should drop all remotes instantly


  2.5m down then 1m limit RVol 33 NRA 30-100
            


*/

  }


  // End Network Statistics


  return { // public interfaces
    startAutoAdjustResolution: function (client, initialProfile, switchForFPSAndBR) {
      _publishClient = client;
      _switchForFPSAndBR = switchForFPSAndBR;
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
    setTempMaxProfile: function (tempMaxProfile) {
      if (tempMaxProfile) {
       _tempMaxProfile=getProfileIndex(tempMaxProfile);
      }
      else {
        _tempMaxProfile=null;
      }
    }, 
    increaseResolution: function () {
      _increaseResolutionAt=Date.now();
     // console.warn(" _increaseResolutionAt "+_increaseResolutionAt);
    }, 
    
    setRemoteVideoPublisherCount: function (remoteVideoPublisherCount_) {
      _remoteVideoPublisherCount=remoteVideoPublisherCount_;
    },      
    isIOS: function () {
      return isIOS();
    },
    isMobile: function () {
      return isMobile();
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
      _monitorRemoteCallStatsInterval = true;
      _remoteCallStatsMonitorFrequency = remoteCallStatsMonitorFrequency;
      setTimeout(() => {
        monitorRemoteCallStats();
      }, _remoteCallStatsMonitorFrequency);
    },
    stopRemoteCallStatsMonitor: function () {
      _monitorRemoteCallStatsInterval = false;
    },
    /*
    startRemoteCallStatsMonitor: function (remoteCallStatsMonitorFrequency) {
      _monitorRemoteCallStatsInterval = setInterval(() => {
        monitorRemoteCallStats();
      }, remoteCallStatsMonitorFrequency);
    },
    stopRemoteCallStatsMonitor: function () {
      clearInterval(_monitorRemoteCallStatsInterval);
      _monitorRemoteCallStatsInterval = null;
    },*/
    RemoteStatusGood: RemoteStatusGood,
    RemoteStatusFair: RemoteStatusFair,
    RemoteStatusPoor: RemoteStatusPoor,
    RemoteStatusCritical: RemoteStatusCritical,
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