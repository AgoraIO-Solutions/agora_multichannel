var AgoraRTCUtils = (function () {

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
  var ResultCountToStepUp=6; // number of consecutive positive results before step up occurrs
  var ResultCountToStepDown=10; // number of consecutive negative results before step down occurrs
  var MinFPSPercent = 90; // below this percentage FPS will a trigger step down
  var MinVideoKbps=100; // below this and the video is likely off or static 

  var _autoAdjustInterval;
  var _publishClient;
  var _currentProfile = 0;
  var _fpsLowObserved = 0;
  var _brLowObserved = 0;
  var _maxProfileDueToLowFPS = 1000;  
  var _brHighObserved = 0;

  var _profiles = [
                // { id: "180p", width: 320, height: 180, frameRate: 15, bitrateMin: 150,  moveDownThreshold: 120, moveUpThreshold: 40, bitrateMax: 500 }, 
                 { id: "360p_low", width: 640, height: 360, frameRate: 24, bitrateMin: 120, moveDownThreshold: 120, moveUpThreshold: 600, bitrateMax: 1000 }, 
                 { id: "360p_11", width: 640, height: 360, frameRate: 24, bitrateMin: 400, moveDownThreshold: 250, moveUpThreshold: 650, bitrateMax: 1000 },
                 { id: "720p", width: 1280, height: 720, frameRate: 24, bitrateMin: 600, moveDownThreshold: 650, moveUpThreshold: 1200, bitrateMax: 1800 },
                //  { id: "1080p", width: 1920, height: 1080, frameRate: 24, bitrateMin: 600, bitrateMinDesired: 1200, bitrateMax: 3600 },
                  ];

  // private methods
  function isIOS() {
    return (/iPhone|iPad|iPod/i.test(navigator.userAgent))
  }

  function getProfileIndex(profile) {
    for (var i=0; i<_profiles.length; i++) {
      if (_profiles[i].id===profile) {
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
    if (videoStats.sendFrameRate && videoStats.sendFrameRate>0 && videoStats.sendFrameRate < (profile.frameRate * MinFPSPercent / 100)) {
      _fpsLowObserved++;
    } else {
      _fpsLowObserved = 0;
    }

    // check outbound bitrate not too low for this resolution
    if (videoStats.sendResolutionWidth > 0 && sendBitratekbps < profile.moveDownThreshold  && sendBitratekbps > MinVideoKbps) {
      _brLowObserved++;
    } else {
      _brLowObserved = 0;
    }

    // see if performing well enough to increase profile
    if (videoStats.sendResolutionWidth > 0 && (videoStats.sendResolutionWidth==profile.width || videoStats.sendResolutionWidth==profile.height) && sendBitratekbps > profile.moveUpThreshold) {
      _brHighObserved++;
    } else {
      _brHighObserved = 0;
    }
    
    // log details
    //console.log("AutoAdjustAlgo profile:"+_currentProfile+", width:"+videoStats.sendResolutionWidth+", height:"+videoStats.sendResolutionHeight+", fps:" + videoStats.sendFrameRate + ", br_kbps:" + sendBitratekbps + ", bad_fps:" + _fpsLowObserved + ", bad_br:" + _brLowObserved + ", good_br:" + _brHighObserved+" ios="+isIOS());
    // +", sendPacketsLost:"+videoStats.sendPacketsLost does not work on Safari
    
    // after 5 seconds of low bandwidth out
    if (_brLowObserved>ResultCountToStepDown) {
      changeProfile(_currentProfile - 1); // reduce profile
    }
    else if (_fpsLowObserved>ResultCountToStepDown) {
      _maxProfileDueToLowFPS=_currentProfile-1; // do not return here
      changeProfile(_currentProfile - 1); // reduce profile
    }

    // after about 5 seconds of very good
    if (_fpsLowObserved == 0 && _brLowObserved == 0 && _currentProfile<_maxProfileDueToLowFPS && _brHighObserved > ResultCountToStepUp && _currentProfile < _profiles.length - 1) {
      changeProfile(_currentProfile + 1); // increase profile
    }
  }

  function changeProfile(profileInd) {
    if (profileInd < 0 || profileInd >= _profiles.length)
      return;
    _currentProfile = profileInd;
    _brLowObserved = 0;
    _brHighObserved = 0;
    _fpsLowObserved = 0;
    var profile = _profiles[profileInd];
    console.log("Auto Adjust Changing Profile to " + profile.id);
    if (_publishClient &&  _publishClient._highStream &&  _publishClient._highStream.videoTrack ) {
      _publishClient._highStream.videoTrack.setEncoderConfiguration({ width: profile.width, height: profile.height, frameRate: profile.frameRate, bitrateMin: profile.bitrateMin, bitrateMax: profile.bitrateMax });
    }
  }

  return { // public interface
    startAutoAdjustResolution: function (client, initialProfile) {
      _publishClient = client;
      _currentProfile = getProfileIndex(initialProfile);
      if (_currentProfile<0)
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

    publicMethod2: function () {
    }
  };
})();