/******************************************************************************
 * Application: Web Demo for multi channel, watch party, screen share with network and device adaptation.
 * 
 * Author:  Ben Weekes
 * Company: Agora.io
 * Date: Mar 1st
 * 
 * Description: This demo app will use multiple agora channels 
 * to increase the number of remote video streams displayed on screeen beyond the limits of a single channel.
 
 * This demo is configured to use 4 channels (maxClients=4) allowing for up to 16*4=64 remote videos.

 * Rather than immediately subscribing to publishing users when a "user-published" event is received,
 * the users are put into a list (videoPublishersByPriority / audioPublishersByPriority).
 * 
 * A function (manageSubscriptions) runs every 150ms which monitors the renderingRate of each of the remote video streams.
 * The renderingRate is an Agora statistic which is incredibly sensitive to fluctations in available network and processing power.
 * Based on the renderingRate of each video stream the number of audio and video subscriptions is increased, held or decreased.
 * 
 * The maximum number of audio subscriptions is configured to 6 while the maximum number of video subscriptions (maxVideoTiles) 
 * is set at 9 for mobile and 49 for desktop.
 * 
 * When somebody starts talking they broadcast a VAD message over RTM to let others in group know that they are talking. 
 * This ensures that their audio is subscribed to if it is not currently (in the situation where more than 6 have their mic unmuted)
 * and that their video is brought on screen if not already.
 * 
 * Monitoring remote render rates works very well unless the sender is not reaching the requested encoding FPS.
 * To address this problem, encoding users share their outbound FPS via RTM when it is falling below 90% of the requested FPS.
 * 
 * Depenending on your network, it can take a reasonabling long amount of time to ramp up to a high number of remote video streams. 
 * Improvemets to the algo could be made to allow it to ramp up more quickly. 
 *
 *****************************************************************************/
class AgoraMultiChanelApp {

  //C'tor: initialize Agora and Angular.
  constructor() {

    // String Constants
    this.VAD = "VAD";
    this.FPS = "FPS";
    this.WATCH = "WATCH";
    this.WATCHYT = "WATCHYT";
    this.STOP_SCREENSHARE="STOP_SCREENSHARE";

    this.VIDEO = "video";
    this.AUDIO = "audio";

    this.AspectRatio = 16 / 9;

    // Page Parameters
    this.appId = getParameterByName("appid");
    this.baseChannelName = getParameterByName("channelBase") || "SA-MULTITEST";
    this.isMobile = getParameterByName("isMobile") || "false";
    this.maxVideoTiles = getParameterByNameAsInt("maxVideoTiles") || ((this.isMobile === "true" || isMobile()) ? 16 : 49);
    this.maxAudioSubscriptions = getParameterByNameAsInt("maxAudioSubscriptions") || 6;
    this.minVideoAllowedSubs = getParameterByNameAsInt("minVideoAllowedSubs") || 1;
    this.initialAudioAllowedSubs = getParameterByNameAsInt("initialAudioAllowedSubs") || 3;
    this.initialVideoAllowedSubs = getParameterByNameAsInt("initialVideoAllowedSubs") || 16;
    this.minAudioAllowedSubs = getParameterByNameAsInt("minAudioAllowedSubs") || 3;
    this.intervalManageSubscriptions = getParameterByNameAsInt("intervalManageSubscriptions") || 150;
    this.numRenderExceedToIncrease = getParameterByNameAsInt("numRenderExceedToIncrease") || 2;
    this.allowedVideoSubsIncreaseBy = getParameterByNameAsInt("allowedVideoSubsIncreaseBy") || 2;
    this.numRenderExceedToDecrease = getParameterByNameAsInt("numRenderExceedToDecrease") || -6;
    this.allowedVideoSubsDecreaseBy = getParameterByNameAsInt("allowedVideoSubsDecreaseBy") || 1;
    this.minRemoteStreamLife = getParameterByNameAsInt("minRemoteStreamLife") || 6 * 1000;

    this.rampUpAgressive = getParameterByName("rampUpAgressive") || "false";
    this.dynamicallyAdjustLowStreamResolution = getParameterByName("dynamicallyAdjustLowStreamResolution") || "false";
    // disable subscriptions for load testing clients 
    this.performSubscriptions = getParameterByName("performSubscriptions") || "true";
    this.muteMicOnJoin = getParameterByName("muteMicOnJoin") || "true";
    this.sendVAD = getParameterByName("sendVAD") || "true";
    this.enableFullLogging = getParameterByName("enableFullLogging") || "false";
    this.enableContentSpeakerMode = getParameterByName("enableContentSpeakerMode") || "true";
    this.superOptimise = getParameterByName("superOptimise") || "false";
    this.mobileShowHighQualityAtStart = getParameterByName("mobileShowHighQualityAtStart") || "true";
    this.enableDualStream = getParameterByName("enableDualStream") || "true";
    this.enableHDAdjust = getParameterByName("enableHDAdjust") || "false";
    this.enableHDAdjustiOS = getParameterByName("enableHDAdjustiOS") || "true";

    this.enableDualStreamMobile = getParameterByName("enableDualStreamMobile") || "false";

    this.vcodec = getParameterByName("vcodec") || "vp8";

    this.enableDualStream = getParameterByName("enableDualStream") || "true";

    // tokens not used in this sample
    this.token = null;

    // Each agora client connects to one Agora channel
    this.maxClients = 4;
    this.maxUsersPerChannel = 16;
    this.numVideoTiles = 0;
    this.videoSubscriptions = {};
    this.audioSubscriptions = {};
    this.videoPublishers = {};
    this.audioPublishers = {};
    this.userMap = {};
    this.fpsMap = {};
    this.allowedVideoSubs = this.initialVideoAllowedSubs;
    this.allowedAudioSubs = this.initialAudioAllowedSubs;
    this.numRenderExceed = 0;
    // first in list is more imporant person 
    this.videoPublishersByPriority = [];
    this.audioPublishersByPriority = [];
    // We'll keep track of one client object per Agora channel to join.
    this.clients = [];
    this.myUid = [];

    this.myPublishClient = -1;
    this.numClients = 0;
    this.numChannels = 0;
    // Seperate video and audio tracks we can manage seperately.
    this.localTracks = {
      videoTrack: null,
      audioTrack: null,
      audioSourceTrack: null
    };

    this.screenTracks = {
      videoTrack: null,
      audioTrack: null
    };
    // All clients will share the same config.
    this.clientConfig = { mode: "rtc", codec: this.vcodec };
    this.lowVideoWidthInitial = getParameterByNameAsInt("lowVideoWidth") || 160; // ||  320;
    this.lowVideoHeightInitial = getParameterByNameAsInt("lowVideoHeight") || 90; // || 180;
    this.lowVideoWidthCurrent = this.lowVideoWidthInitial;
    this.lowVideoHeightCurrent = this.lowVideoHeightInitial;
    this.lowVideoWidthSmall = 160;
    this.lowVideoHeightSmall = 90;

    this.LowVideoStreamType = 1;
    this.HighVideoStreamType = 0;

    this.defaultVideoStreamType = this.LowVideoStreamType;
    if (this.mobileShowHighQualityAtStart === "true" || !isMobile()) {
      this.defaultVideoStreamType = this.HighVideoStreamType;
    }

    // number of subscriptions before moving to low stream
    this.SwitchVideoStreamTypeAt = 9;
    // drop the low quality stream as more users join to ensure the aggregate resolution keeps low
    // not used - caused blink
    //this.SwitchDownLowPublishResolutionAt = 15; // will drop the lowbandwidth stream shown in grid from 180p to 90p
    //this.SwitchUpLowPublishResolutionAt = 10;

    this.CellWidthBase = 160;
    this.CellHeightBase = 90;

    this.maxFPS = 24;
    this.lowVideoFPS = this.maxFPS; //isMobile() ? 15 : this.maxFPS;
    this.lowVideoBitrate = 200;

    this.highVideoWidth = 640; //isMobile() ? 320 : 640;
    this.highVideoHeight = 360; // isMobile() ? 180 : 360;
    this.highVideoFPS = this.maxFPS; //isMobile() ? 15 : this.maxFPS;
    this.highVideoBitrateMin = 400;
    this.highVideoBitrateMax = 1000;
    this.FPSThresholdToIncreaseSubs = 0.9;
    this.FPSThresholdToReduceSubs = 0.5;

    // RTM
    this.rtmClient;
    this.rtmUid;
    this.rtmChannelName;
    this.rtmChannel;

    // VAD
    this.vadUid;
    this.mainVideoId;
    this.vadSend = 0;
    this.vadSendWait = 2 * 1000;
    this.vadRecv = 0;
    this.vadRecvWait = 3 * 1000;

    // Screenshare
    this.maxScreenshareUID=100;
    this.minScreenshareUID=10;
    this.currScreenshareUID=10;
    this.screenClient;

    // Bandwidth Control
    this.lowStreamResolutionSwitchWait = 10 * 1000;
    this.lowStreamResolutionSwitch = 0;

    this.outboundFPSLow = 0;
    this.outboundFPSHigh = 0;
    this.OutboundStatsWait = 2000;
    this.outboundStatsLast = 0;
    this.outboundFPSHigh2 = 0;
    this.outboundWidth = 0;
    this.outboundHeight = 0;
    this.outboundBitrate = 0;
    this.outboundFPSLow2 = 0;
    this.outboundFrameCountHigh = 0;
    this.outboundFrameCountLow = 0;
    this.outboundFrameCount = 0;
    this.InboundStatsMonitorInterval = 15;
    this.debugInboundStats = this.InboundStatsMonitorInterval;
    this.mobileUIUpdated = false;
    this.mobileUIUpdatedLandscape = false;
    this.mobileUIUpdatedPortrait = false;
    this.gridLayout = true;
    this.landscape = true;

    this.manageGridLast = 0;
    this.ManageGridWait = getParameterByNameAsInt("ManageGridWait") || 500;

    this.cameraId;
    this.micId;
    this.shareContentOnDisplay = false;
    this.shownPersonToPerson = false;
    this.hostingWatchParty = false;

    // check an appid has been passed in
    if (!this.appId) {
      alert("No appid");
      return;
    }
  }

  async init() {
    await this.createClients();
    await this.joinChannels();
    //
    setInterval(() => {
      this.manageSubscriptions();
    }, this.intervalManageSubscriptions);

    AgoraRTCUtils.setRTCClients(this.clients,this.numClients);
    AgoraRTCUtils.startInboundVolumeMonitor(100); // ms interval
  }

  async createClients() {
    let i = 0;
    // Create the max number of client objects.
    AgoraRTC.enableLogUpload();
    AgoraRTC.setLogLevel(1);

    for (i; i < this.maxClients; i++) {
      this.clients[i] = AgoraRTC.createClient(this.clientConfig);
      let currentClient = this.clients[i];

      /* Each client object will need the same event handlers. */
      // Add the remote publish event

      // When a remote user publishes he will be added to a list of publishers
      // A separate mechanism will decide who to subscribe to from that list
      // Ideally it would be everyone but that is not possible on low end devices and poor networks
      // If someone is subscribed to for audio (because unumted) then they should also be subscribed to for video
      // We may want specific users (instructor) to always be subscribed to.
      // The best way to quickly detect client issues (due to either cpu or network) is the average renderFrameRate which is instantly impacted if either the network or cpu is not keeping up

      this.clients[i].on("user-published", async (user, mediaType) => {
        var uid_string = user.uid.toString();
        //console.error(" adding user "+uid_string);
        this.userMap[uid_string] = user;

        if (mediaType === this.VIDEO) {
          this.videoPublishers[uid_string] = currentClient;
          delete this.videoSubscriptions[uid_string];

          // check not already in the priority array
          this.removeUidFromArray(this.videoPublishersByPriority, uid_string);
          // new publishers go on the end of the list in terms of page priority 
          // audio priority will influence video priority but remote users may not be publishing any audio

          var index = this.audioPublishersByPriority.indexOf(uid_string);
          if (index > -1) {
            this.videoPublishersByPriority.splice(index, 0, uid_string);
          } else {
            // rather than push on the end
            // insert them after audio count so they are not first to go
            if (this.videoPublishersByPriority.length > this.audioPublishersByPriority.length) {
              this.videoPublishersByPriority.splice(this.audioPublishersByPriority.length, 0, uid_string);
            } else {
              this.videoPublishersByPriority.push(uid_string);
            }
          }
        }
        else if (mediaType === this.AUDIO) {
          this.audioPublishers[uid_string] = currentClient;
          delete this.audioSubscriptions[uid_string];
          // check not  already in the priority array
          this.removeUidFromArray(this.audioPublishersByPriority, uid_string);
          // default order will be chronological but this will be rearranged using the VAD
          this.audioPublishersByPriority.push(uid_string);
        }
      });

      // unpublished is called when users mute. Best not to remove them from UI completely
      this.clients[i].on("user-unpublished", async (user, mediaType) => {
        var uid_string = user.uid.toString();
        console.warn("user-unpublished " + uid_string);
        if (mediaType === this.VIDEO) {
          delete this.videoPublishers[uid_string];
          delete this.videoSubscriptions[uid_string];
          this.removeUidFromArray(this.videoPublishersByPriority, uid_string);
        }
        else if (mediaType === this.AUDIO) {
          delete this.audioPublishers[uid_string];
          delete this.audioSubscriptions[uid_string];
          this.removeUidFromArray(this.audioPublishersByPriority, uid_string);
        }
      });

      this.clients[i].on("user-left",
        async (user) => {
          delete this.videoPublishers[user.uid.toString()];
          delete this.videoSubscriptions[user.uid.toString()];
          delete this.audioPublishers[user.uid.toString()];
          delete this.audioSubscriptions[user.uid.toString()];
          this.removeUidFromArray(this.audioPublishersByPriority, user.uid.toString());
          this.removeUidFromArray(this.videoPublishersByPriority, user.uid.toString());
        });
    }
    this.numClients = i;
  }

  getMaxVideoTiles() {
    if (this.localTracks.videoTrack != null && agoraApp.localTracks.videoTrack._enabled) {
      return this.maxVideoTiles - 1;
    }
    return this.maxVideoTiles;
  }

  manageSubscriptions() {
    this.useCallStatsToAdjustNumberOfSubscriptions();
    //this.voiceActivityDetection();
    if (this.mobileShowHighQualityAtStart === "true" || !isMobile()) {
      this.doSwitchRxVideoStreamTypeAt();
    }
    //this.changeLowStreamResolutionIfNeeded();
    this.manageGrid();
  }

  dictionaryLength(dict) {
    return Object.keys(dict).length
  }

  getMapSize(x) {
    var len = 0;
    for (var count in x) {
      len++;
    }
    return len;
  }

  manageGrid() {
    var now = Date.now();
    if ((now - this.manageGridLast) < this.ManageGridWait) {
      return;
    }
    this.manageGridLast = now;

    // max slots by page
    // max slots by CPU/Network
    // audio should be priority

    // ** Video **
    // numVideoSlots (the number of slots (grid cells) on screen) is the smaller of this.maxVideoTiles or videoPublishersByPriority (numPubs)
    // allowedSubs is the number of subs allowed by the network / CPU (minVideoAllowedSubs=0)
    // numSubs is the smaller of allowedSubs and numSlots        
    var numVideoSlots = Math.min(this.getMaxVideoTiles(), this.videoPublishersByPriority.length);
    var numVideoSubs = Math.min(this.allowedVideoSubs, numVideoSlots);
    // both of these will be 0 to self from the videoPublishersByPriority
    // page and SDK can be checked and fixed

    // video slots
    var expectedVideoSlots = {};
    for (var v = 0; v < numVideoSlots; v++) {
      // any slots not present add
      this.addVideoSlotIfNotExisting(this.videoPublishersByPriority[v]);
      // remove any slots present which should not be  
      expectedVideoSlots[this.videoPublishersByPriority[v]] = this.videoPublishersByPriority[v];
    }
    this.removeSlotsIfNotInMap(expectedVideoSlots);

    // video subs
    var expectedVideoSubs = {};
    for (var v = 0; v < numVideoSubs; v++) {
      // add any subs not present 
      this.addVideoSubIfNotExisting(this.videoPublishersByPriority[v]);
      // remove any slots present which should not be  
      expectedVideoSubs[this.videoPublishersByPriority[v]] = this.videoPublishersByPriority[v];
    }

    this.removeVideoSubsIfNotInMap(expectedVideoSubs);

    // ** Audio ** 
    // numSlots is the smaller of maxAudioSubscriptions (6) and audioPublishersByPriority
    // allowedSubs is the number of subs allowed by the network / CPU (minAudioAllowedSubs=3)
    // numSubs is the smaller of allowedSubs and numSlots
    var numAudioSlots = Math.min(this.maxAudioSubscriptions, this.audioPublishersByPriority.length);
    var numAudioSubs = Math.min(this.allowedAudioSubs, numAudioSlots);

    // audio slots 
    // audio subs
    var expectedAudioSubs = {};
    for (var v = 0; v < numAudioSubs; v++) {
      // any slots not present add
      this.addAudioSubIfNotExisting(this.audioPublishersByPriority[v]);
      // remove any slots present which should not be  
      expectedAudioSubs[this.audioPublishersByPriority[v]] = this.audioPublishersByPriority[v];
    }
    this.removeAudioSubsIfNotInMap(expectedAudioSubs);

    //#B3
    if (!this.gridLayout && this.getMapSize(this.videoSubscriptions) == 0 && !this.shareContentOnDisplay) {
      this.toggleLayout();
    }
    this.updateUILayout();
  }

  async removeAudioSubsIfNotInMap(expected) {
    var that = this;
    Object.keys(this.audioSubscriptions).forEach(async function (key) {
      if (!expected[key]) {
        var user = that.userMap[key];
        var client = that.audioPublishers[key];
        var prom = await client.unsubscribe(user, that.AUDIO);
        delete that.audioSubscriptions[key];
        // console.warn(" removeAudioSubsIfNotInMap  " + key+ " allowedAudioSubs " + that.allowedAudioSubs);
      }
    });
  }

  async addAudioSubIfNotExisting(uid_string) {
    if (this.audioSubscriptions[uid_string]) {
      return;
    }
    var user = this.userMap[uid_string];
    var client = this.audioPublishers[uid_string];
    this.audioSubscriptions[uid_string] = client;
    var that = this;
    if (this.performSubscriptions === "true") {
      await client.subscribe(user, this.AUDIO).then(response => {
        user.audioTrack.play();
      }).catch(e => {
        delete that.audioSubscriptions[uid_string];
        console.error(e);
      });
    }
  }

  async removeVideoSubsIfNotInMap(expected) {
    var that = this;
    Object.keys(this.videoSubscriptions).forEach(async function (key) {
      if (!expected[key]) {
        var then = that.videoSubscriptions[key];
        if ((Date.now() - then) > that.minRemoteStreamLife) {
          console.log(" removeVideoSubsIfNotInMap " + key + " allowedVideoSubs " + that.allowedVideoSubs + " age " + (Date.now() - then));
          var user = that.userMap[key];
          var client = that.videoPublishers[key];
          var prom = await client.unsubscribe(user, that.VIDEO);
          delete that.videoSubscriptions[key];
        }
      }
    });
  }


  async addVideoSubIfNotExisting(uid_string) {
    if (this.videoSubscriptions[uid_string]) {
      return;
    }
    var user = this.userMap[uid_string];
    if (!user) {
      console.error("No USER " + uid_string);
    }
    var client = this.videoPublishers[uid_string];

    this.videoSubscriptions[uid_string] = Date.now();  // now client; 
    var that = this;
    if (this.performSubscriptions === "true") {
      await client.subscribe(user, this.VIDEO).then(response => {

        user.videoTrack.play(uid_string);
        that.removeAgoraInnerVideoStyling();
        // allow stream to fallback to audio only when congested
        // 1 is for low quality
        client.setStreamFallbackOption(user.uid, 1);
        client.setRemoteVideoStreamType(user.uid, that.defaultVideoStreamType);
        // handleScreenshareSub
        that.handleScreenshareSub(uid_string);

      }).catch(e => {
        delete that.videoSubscriptions[uid_string];
        console.error(e);
      });
    }
  }


  removeAgoraInnerVideoStyling() {
    var els = document.getElementsByClassName("remote_video");
    var that = this;
    Array.prototype.forEach.call(els, function (el) {
        var children = el.childNodes;
        children.forEach(function(item){
          if (!item.className.match(/\bremove_agora_video_style\b/)){
            item.classList.add("remove_agora_video_style");
          }
         
        });
      });

    // remove tile if in follow speaker area
    els = document.getElementsByClassName("focussed-video-inner");
    Array.prototype.forEach.call(els, function (el) {        
      var children = el.childNodes;
      children.forEach(function(item){
        if (!item.className.match(/\bremove_agora_video_style\b/)){
          item.classList.add("remove_agora_video_style");
        }
       
      });
    });

      // remove tile if in follow speaker area
      els = document.getElementsByClassName("local_video");
      Array.prototype.forEach.call(els, function (el) {        
        var children = el.childNodes;
        children.forEach(function(item){
          if (!item.className.match(/\bremove_agora_video_style\b/)){
            item.classList.add("remove_agora_video_style");
          }
          
        });
      });

      // remove tile if in follow speaker area
      els = document.getElementsByClassName("player");
      Array.prototype.forEach.call(els, function (el) {        
        var children = el.childNodes;
        children.forEach(function(item){
          if (!item.className.match(/\bremove_agora_video_style\b/)){
            item.classList.add("remove_agora_video_style");
          }
          
        });
      });

      
    
  }

  removeSlotsIfNotInMap(expected) {
    var els = document.getElementsByClassName("remote_video");
    var that = this;
    Array.prototype.forEach.call(els, function (el) {
      if (!expected[el.id]) {
        that.numVideoTiles--;
        el.remove();
      }
    });

    // remove tile if in follow speaker area
    els = document.getElementsByClassName("focussed-video-inner");
    Array.prototype.forEach.call(els, function (el) {
      if (!expected[el.id]) {
        that.numVideoTiles--;
        el.remove();
        // someone or thing in big window has dropped
        that.mainVideoId=null;
        that.disableShareContent();
      }
    });
  }

  addVideoSlotIfNotExisting(uid_string) {
    if (!document.getElementById(uid_string)) {
      const playerDomDiv = document.createElement("div");
      playerDomDiv.id = uid_string;
      var setClass= "remote_video";
      if (isMobile())
        setClass= "remote_video remote_video_mobile";

      playerDomDiv.className =setClass;
      
      // click to expand and subscribe to high quality
      var that = this;
      var client = that.videoPublishers[uid_string];

      playerDomDiv.onclick = function () {

        if (isMobile() && that.landscape) {
          return;
        }
        if (that.gridLayout && that.enableContentSpeakerMode === "true") {
          that.toggleLayout(false);
        }
        if (that.mainVideoId !== uid_string) {
          that.moveToLargeWindow(uid_string);
        }
        /*
        if (!document.fullscreenElement) {

          var element = document.getElementById(uid_string);
          if (element.requestFullscreen) {
            element.requestFullscreen();
          } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
          } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
          } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
          }
          

          client.setRemoteVideoStreamType(that.userMap[uid_string].uid, this.HighVideoStreamType);
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
          client.setRemoteVideoStreamType(that.userMap[uid_string].uid, this.defaultVideoStreamType);
        }
        */
      };
      document.getElementById("grid").append(playerDomDiv);
      this.numVideoTiles++;
    }
  }

  showGridView() {
    if (!this.gridLayout) {
      this.toggleLayout();
    }
  }

  showContentView() {
    if (this.gridLayout) {
      this.toggleLayout();
    }
  }

  toggleLayout(loadActiveSpeaker) {
    if (this.gridLayout) {
      if (this.videoPublishersByPriority.length > 0 || this.shareContentOnDisplay) {
        this.gridLayout = false;
        document.getElementById("focus-video").classList.remove("hidden");
        document.getElementById("grid").classList.add("grid_wrapper_follow");
        if (loadActiveSpeaker) {
          this.moveToLargeWindow(this.videoPublishersByPriority[0]);
        }
      }
    } else { // follow speaker
      this.gridLayout = true;
      document.getElementById("focus-video").classList.add("hidden");
      document.getElementById("grid").classList.remove("grid_wrapper_follow");
      this.returnLargeToGrid(); // removes current large window user
    }
  }

  // share content covers both screen and watchparty
  // if you start a screen share you cancel existing watch for all
  // you cancel screenshare if local
  // on receiving another screenshare previous is dropped 
  // better to send RTM
  enableShareContent() {
    if (this.mainVideoId) {
      this.returnLargeToGrid(); 
    }
    // don't set until above called to take person out of this view
    this.shareContentOnDisplay = true;
    this.showContentView();
  }

  disableShareContent() {
    // if local user is hosting watch party
    // it will exit locally for him
    // others will keep receiving the queue message
    // 
    if (this.hostingWatchParty)
      return;
    this.shareContentOnDisplay = false;
    this.showGridView();
  }


  handleScreenshareSub(uid_string) {
    var uidi=parseInt(uid_string, 10);
    if (uidi < this.maxScreenshareUID) {
      this.currScreenshareUID=uidi;

      if (!this.shareContentOnDisplay) {
        this.showContentView();
        if (this.mainVideoId !== uid_string) {
          this.moveToLargeWindow(uid_string);
        }
        this.shareContentOnDisplay = true;
      } else {
        this.stopScreensharePublish(); // will stop current one if local
        if (this.mainVideoId !== uid_string) {
          this.moveToLargeWindow(uid_string);
        }
        this.shareContentOnDisplay = true;
      }
    }
  }

  returnLargeToGrid(){
    this.moveToLargeWindow(); // removes mainVideoId if no arg passed
  }

  moveToLargeWindow(uid_string) {
    // if null we are moving him out only
    // in the case of screen content we don't want to actually move the users
    if (uid_string && uid_string == this.mainVideoId) {
      return;
    }
    else if (uid_string) {
      var moveel = document.getElementById(uid_string);
      if (moveel && this.videoPublishers[uid_string]) {
        if (this.mainVideoId) {
          var prevMain = document.getElementById(this.mainVideoId);
          if (prevMain) { // put back in grid
            var gridel = document.getElementById("grid");
            if (!this.shareContentOnDisplay && this.enableContentSpeakerMode === "true") {
              prevMain.classList.add("remote_video");
              prevMain.classList.remove("focussed-video-inner");
              gridel.insertBefore(prevMain, moveel);
            }
            this.videoPublishers[this.mainVideoId].setRemoteVideoStreamType(this.userMap[this.mainVideoId].uid, this.defaultVideoStreamType);
          }
        }
        var parent = document.getElementById("focus-video");
        if (!this.shareContentOnDisplay && this.enableContentSpeakerMode === "true") {
          parent.appendChild(moveel);
          moveel.classList.remove("remote_video");
          moveel.classList.remove("remote_video_active");
          moveel.classList.add("focussed-video-inner");
        }
        this.mainVideoId = uid_string;
        this.videoPublishers[uid_string].setRemoteVideoStreamType(this.userMap[uid_string].uid, this.HighVideoStreamType);
      }
    } else {
      if (this.mainVideoId && this.videoPublishers[this.mainVideoId]) {
        var prevMain = document.getElementById(this.mainVideoId);
        if (prevMain) { // put back in grid
          var gridel = document.getElementById("grid");
          if (!this.shareContentOnDisplay && this.enableContentSpeakerMode === "true") {
            gridel.insertBefore(prevMain, document.getElementsByClassName('remote_video')[0]);
            prevMain.classList.add("remote_video");
            prevMain.classList.remove("focussed-video-inner");
          }
        }
        this.videoPublishers[this.mainVideoId].setRemoteVideoStreamType(this.userMap[this.mainVideoId].uid, this.defaultVideoStreamType);
        this.mainVideoId = null;
      }
    }
    this.updateUILayout();

  }
  removeUidFromArray(array_, uid) {
    var index = array_.indexOf(uid);
    if (index > -1) {
      array_.splice(index, 1);
      return true;
    }
    return false;
  }

  promoteUidToFrontOfArrayIfPresent(array_, uid) {
    if (this.removeUidFromArray(array_, uid)) {
      array_.unshift(uid);
    }
  }

  initRTM() {
    this.rtmClient = AgoraRTM.createInstance(this.appId, { logFilter: AgoraRTM.LOG_FILTER_OFF });

    this.rtmClient.on('ConnectionStateChanged', (newState, reason) => {
      console.log('this.rtmClient connection state changed to ' + newState + ' reason: ' + reason);
    });

    this.rtmClient.login({ token: null, uid: this.rtmUid }).then(() => {
      this.rtmChannel = this.rtmClient.createChannel(this.rtmChannelName);
      this.rtmChannel.join().then(() => {
        this.rtmChannel.on('ChannelMessage', ({ text }, senderId) => {
          this.handleRTM(senderId, text);
        });
      }).catch(error => {
        console.log('AgoraRTM client join failure', error);
      });
    }).catch(error => {
      console.log('AgoraRTM client login failure', error);
    });
  }

  handleRTM(senderId, text) {

    if (text.startsWith(this.VAD) && (Date.now() - this.vadRecv) > this.vadRecvWait) {
      this.vadRecv = Date.now();
      var vadUid = text.split(":")[1];
      if (this.vadUid && document.getElementById(this.vadUid)) {
        document.getElementById(this.vadUid).classList.remove("remote_video_active");
      }

      this.vadUid = vadUid;
      if (document.getElementById(this.vadUid)) {
        //move this user to the large window if in follow mode
        if (!this.gridLayout && !this.shareContentOnDisplay) {
          this.moveToLargeWindow(this.vadUid);
        } else {
          document.getElementById(this.vadUid).classList.add("remote_video_active");
        }
      }

      // this person is talking now
      // they should be in the audio publishing list
      this.promoteUidToFrontOfArrayIfPresent(this.audioPublishersByPriority, this.vadUid);
      // they might be in the video publishing list 
      this.promoteUidToFrontOfArrayIfPresent(this.videoPublishersByPriority, this.vadUid);
      // they should become top priority in both
    } else if (text.startsWith(this.FPS)) {
      var fpsUid = text.split(":")[1];
      var fps = text.split(":")[2];
      //console.log("adding FPS "+fps+" for "+fpsUid );
      this.fpsMap[fpsUid] = fps;
    } else if (text.startsWith(this.WATCHYT)) {
      agoraWatchYT.handleRTM(text);
    } else if (text.startsWith(this.WATCH)) {
      agoraWatchParty.handleRTM(text);
    } else if (text.startsWith(this.STOP_SCREENSHARE)) {
        this.stopScreensharePublishLocal();
    }
    
  }

  getInputLevel(track) {
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

  voiceActivityDetection() {
    if (!this.localTracks.audioTrack || !this.rtmChannel || this.sendVAD !== "true") {
      return;
    }
    var audioLevel = this.getInputLevel(this.localTracks.audioTrack); //Math.floor(this.getInputLevel(this.localTracks.audioTrack));
    if (audioLevel <= this.MaxBackgroundNoiseLevel) {
      if (this.audioSamplesArr.length >= this.MaxAudioSamples) {
        var removed = this.audioSamplesArr.shift();
        var removedIndex = this.audioSamplesArrSorted.indexOf(removed);
        if (removedIndex > -1) {
          this.audioSamplesArrSorted.splice(removedIndex, 1);
        }
      }
      this.audioSamplesArr.push(audioLevel);
      this.audioSamplesArrSorted.push(audioLevel);
      this.audioSamplesArrSorted.sort((a, b) => a - b);
    }
    var background = Math.floor(3 * this.audioSamplesArrSorted[Math.floor(this.audioSamplesArrSorted.length / 2)] / 2);
    if (audioLevel > background + this.SilenceOffeset) {
      this.exceedCount++;
    } else {
      this.exceedCount = 0;
    }

    if (this.exceedCount > this.exceedCountThreshold) {
      this.exceedCount = 0;

    }
  }

  // Publishing Local Streams
  async joinChannels() {
    let tempChannelName = "";
    let i = 0;
    // Join one channel for each client object.
    for (i; i < this.numClients; i++) {
      tempChannelName = this.baseChannelName + i.toString();
      this.myUid[i] = await this.clients[i].join(this.appId, tempChannelName,
        this.token, null);
    }
    // we will use the last channel name and UID to join RTM for send/receive VAD messages
    this.rtmChannelName = tempChannelName;
    this.rtmUid = this.myUid[i - 1].toString();
    this.initRTM();
    this.numChannels = i;
  }

  async loadDevices() {
    // create local tracks
    [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
      {}, { encoderConfig: { width: this.highVideoWidth, height: this.highVideoHeight, frameRate: this.highVideoFPS, bitrateMin: this.highVideoBitrateMin, bitrateMax: this.highVideoBitrateMax } });
  }

  async startCamMic(cameraId, micId) {
    if (isChromeIOS()) {
      return; // chrome on iOS doesn't support getUserMedia
    }

    this.getFirstOpenChannel();
    this.cameraId = cameraId;
    this.micId = micId;
    await this.publishAudioVideoToChannel();
    if (this.muteMicOnJoin === "true") {
      toggleMic();
    }
  }

  
  async stopScreensharePublishLocal(){
    if (this.screenClient) {
      if (this.screenTracks &&   this.screenTracks.videoTrack) {
        this.screenTracks.videoTrack.close(); // close on screen
      }      
      await this.screenClient.leave();
      this.screenClient=null;            
    } 
  }

  async stopScreensharePublish(){
    if (this.screenClient) {
      this.stopScreensharePublishLocal();   
    } else {
      var msg = this.STOP_SCREENSHARE;
      this.rtmChannel.sendMessage({ text: msg }).then(() => {
      }).catch(error => {
          console.log('AgoraRTM send failure for stopScreensharePublish');
      });
    }
  }

  async publishScreenShareToChannel() {
    this.screenClient = AgoraRTC.createClient(this.clientConfig);
    var availableClient= this.getFirstOpenChannelInner();
    let tempChannelName = this.baseChannelName + availableClient.toString(); 
    var ssuid= this.currScreenshareUID+1;
    if (ssuid>=this.maxScreenshareUID) {
      ssuid=this.minScreenshareUID;
    }
    await this.screenClient.join(this.appId, tempChannelName, null, ssuid);

    var screenRet = await Promise.all([
      AgoraRTC.createScreenVideoTrack({ optimizationMode: "detail", encoderConfig: { width: 1280, height: 720, frameRate: 24, bitrateMin: 1200, bitrateMax: 3000 } }, "auto")
    ]);

    if (screenRet[0]) {
      if (screenRet[0][0]) {
        this.screenTracks.videoTrack = screenRet[0][0];
        if (screenRet[0][1]) {
          this.screenTracks.audioTrack = screenRet[0][1];
        }
        await this.screenClient.publish(Object.values(this.screenTracks));
      }
      else {
        this.screenTracks.videoTrack = screenRet[0];
        this.screenTracks.audioTrack = null;

        await this.screenClient.publish(this.screenTracks.videoTrack);
      }

      var that=this;
      this.screenTracks.videoTrack._originMediaStreamTrack.onended = function () {
        that.stopScreensharePublishLocal();  that.showGridView(); agoraWatchParty.togglePlayerControls(); 
       };
    }

    // send RTM to stop anyone else publishing screen
    // local should put into focussed directly now
    //await this.screenTracks.videoTrack.play("focus-video");
    console.log("publish success");
  }

  async publishAudioVideoToChannel() {

    // create together for single allow
    if (!this.localTracks.audioTrack) {
      if (this.cameraId && this.micId) {
        [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
          { microphoneId: this.micId }, { cameraId: this.cameraId, encoderConfig: { width: this.highVideoWidth, height: this.highVideoHeight, frameRate: this.highVideoFPS, bitrateMin: this.highVideoBitrateMin, bitrateMax: this.highVideoBitrateMax } });
      } else {
        [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
          {}, { encoderConfig: { width: this.highVideoWidth, height: this.highVideoHeight, frameRate: this.highVideoFPS, bitrateMin: this.highVideoBitrateMin, bitrateMax: this.highVideoBitrateMax } });
      }
    }

    if ((this.enableDualStream === "true" && !isMobile()) || this.enableDualStreamMobile === "true") {
      this.clients[this.myPublishClient].enableDualStream().then(() => {
        console.log("Enable Dual stream success!");
      }).catch(err => {
        console.log(err);
      })
      this.clients[this.myPublishClient].setLowStreamParameter({ bitrate: this.lowVideoBitrate, framerate: this.lowVideoFPS, height: this.lowVideoHeightCurrent, width: this.lowVideoWidthCurrent });
    }

    this.localTracks.videoTrack.play("local-player");
    document.getElementById("local-player").classList.remove("hidden");
    await this.clients[this.myPublishClient].publish([this.localTracks.audioTrack, this.localTracks.videoTrack]);
    
    if (this.enableHDAdjust === "true" || (AgoraRTCUtils.isIOS() &&  this.enableHDAdjustiOS === "true")) {
      AgoraRTCUtils.startAutoAdjustResolution(this.clients[this.myPublishClient], "360p_11");
    }
    
    
    AgoraRTCUtils.startVoiceActivityDetection(this.localTracks.audioTrack);
    AgoraRTCUtilEvents.on("VoiceActivityDetected",agoraApp.handleVADEvents);

    document.getElementById("mic_on").classList.add("hidden");
    document.getElementById("mic_off").classList.remove("hidden");
    document.getElementById("cam_on").classList.add("hidden");
    document.getElementById("cam_off").classList.remove("hidden");
  }


  handleVADEvents(_vad_exceedCount) {

    if (!agoraApp.rtmChannel || agoraApp.sendVAD !== "true") {
      return;
    }

    if ((Date.now() - agoraApp.vadSend) > agoraApp.vadSendWait) {
      agoraApp.vadSend = Date.now();
      agoraApp.rtmChannel.sendMessage({ text: agoraApp.VAD + ':' + agoraApp.myUid[agoraApp.myPublishClient] }).then(() => {
        if (agoraApp.vadUid && document.getElementById(agoraApp.vadUid)) {
          document.getElementById(agoraApp.vadUid).classList.remove("remote_video_active");
        }
        agoraApp.vadUid="local-player";
        document.getElementById(agoraApp.vadUid).classList.add("remote_video_active");
        
      }).catch(error => {
        console.log('AgoraRTM VAD send failure');
      });
    }
  }

  /*
  async changeLowStreamResolutionIfNeeded() {
    if (this.dynamicallyAdjustLowStreamResolution === "false") {
      return;
    }

    var subs = this.getMapSize(this.videoPublishers);
    if (subs >= this.SwitchDownLowPublishResolutionAt && this.lowVideoWidthCurrent != this.lowVideoWidthSmall) {
      if ((Date.now() - this.lowStreamResolutionSwitch) > this.lowStreamResolutionSwitchWait) {
        this.lowStreamResolutionSwitch = Date.now();
        this.lowVideoWidthCurrent = this.lowVideoWidthSmall;
        this.lowVideoHeightCurrent = this.lowVideoHeightSmall;
        // avoid every client doing it together 
        var that = this;
        var randWait = (this.lowStreamResolutionSwitchWait / 2) * Math.random();
        setTimeout(async function () { await that.stopPublishingVideo(); await that.publishVideoToChannel(); }, randWait);
      }
    } else if (subs < this.SwitchUpLowPublishResolutionAt && this.lowVideoWidthCurrent != this.lowVideoWidthInitial) {
      if ((Date.now() - this.lowStreamResolutionSwitch) > this.lowStreamResolutionSwitchWait) {
        this.lowStreamResolutionSwitch = Date.now();
        this.lowVideoWidthCurrent = this.lowVideoWidthInitial;
        this.lowVideoHeightCurrent = this.lowVideoHeightInitial;
        var randWait = (this.lowStreamResolutionSwitchWait / 2) * Math.random();
        var that = this;
        setTimeout(async function () { await that.stopPublishingVideo(); await that.publishVideoToChannel(); }, randWait);
      }
    }
  }
*/
  async stopPublishingVideo() {
    if (this.localTracks.videoTrack != null) {
      console.log("### stopPublishingVideo VIDEO! ###");
      await this.localTracks.videoTrack.setEnabled(false);
      await this.clients[this.myPublishClient].unpublish(this.localTracks.videoTrack);
      await this.localTracks.videoTrack.stop();
      await this.localTracks.videoTrack.close();

      //await this.localTracks.videoTrack.stop();
      this.localTracks.videoTrack = null;
    }
  }

  async publishVideoToChannel() {
    // If we're currently capturing, unpublish and stop the track.
    if (this.localTracks.videoTrack != null) {
      console.log("### UNPUBLISHED VIDEO! ###");
      await this.clients[this.myPublishClient].unpublish(this.localTracks.videoTrack);
      await this.localTracks.videoTrack.setEnabled(false);
      //  await this.localTracks.videoTrack.stop();
      this.localTracks.videoTrack = null;
    }

    this.localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack({
      cameraId: this.cameraId, encoderConfig: { width: this.highVideoWidth, height: this.highVideoHeight, frameRate: this.highVideoFPS, bitrateMin: this.highVideoBitrateMin, bitrateMax: this.highVideoBitrateMax }
    });

    if ((this.enableDualStream === "true" && !isMobile()) || this.enableDualStreamMobile === "true") {
      this.clients[this.myPublishClient].enableDualStream().then(() => {
        console.log("Enable Dual stream success!");
      }).catch(err => {
        console.log(err);
      })
      this.clients[this.myPublishClient].setLowStreamParameter({ bitrate: this.lowVideoBitrate, framerate: this.lowVideoFPS, height: this.lowVideoHeightCurrent, width: this.lowVideoWidthCurrent });
    }

    this.localTracks.videoTrack.play("local-player");
    await this.clients[this.myPublishClient].publish(this.localTracks.videoTrack);
    
    if (this.enableHDAdjust === "true" || (AgoraRTCUtils.isIOS() &&  this.enableHDAdjustiOS === "true")) {
      AgoraRTCUtils.startAutoAdjustResolution(this.clients[this.myPublishClient], "360p_11");
    }

    console.log("### PUBLISHED VIDEO Low Res changed " + this.lowVideoHeightCurrent + "p ###");
  }

  async publishAudioToChannel(microphoneId, publishToIndex) {
    // If we're currently capturing, unpublish and stop the track.
    if (this.localTracks.audioTrack != null) {
      console.log("### UNPUBLISHED AUDIO! ###");
      await this.clients[publishToIndex].unpublish(this.localTracks.audioTrack);
      this.localTracks.audioTrack.stop();
    }

    // Create a new track and publish.
    this.localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
      microphoneId: microphoneId,
    });
    await this.clients[publishToIndex].publish(this.localTracks.audioTrack);
    AgoraRTCUtils.startVoiceActivityDetection(this.localTracks.audioTrack);
    console.log("### PUBLISHED AUDIO TO " + publishToIndex + "! ###");
  }

  // Returns the index of the first client object with an open channel.
  getFirstOpenChannel() {

    if (this.myPublishClient > -1) {
      return this.myPublishClient;
    }

    this.myPublishClient=this.getFirstOpenChannelInner();
    return this.myPublishClient;
  }


    // Returns the index of the first client object with an open channel.
    getFirstOpenChannelInner() {
      let tempCount = 0;
      for (var i = 0; i < this.numClients; i++) {
        tempCount = this.clients[i]._users.length;
        if (tempCount < this.maxUsersPerChannel) {
          return i;
        }
      }
    }

  setRemoteVolumes(vol) {
    for (var i = 0; i < this.numClients; i++) {
      var client = this.clients[i];
      var ua = client._users;
      if (ua)
        ua.forEach(element => element.audioTrack ? element.audioTrack.setVolume(vol) : 0);
    }
  }

  getOutboundStats() {
    var now = Date.now();
    if ((now - this.outboundStatsLast) < this.OutboundStatsWait) {
      return;
    }

    var timedelta = 0;
    if (this.outboundStatsLast > 0) {
      timedelta = now - this.outboundStatsLast;
    }
    this.outboundStatsLast = now;
    if (this.myPublishClient > -1 && this.clients[this.myPublishClient] && this.clients[this.myPublishClient]._lowStream) {
      var lowStream = this.clients[this.myPublishClient]._lowStream;
      if (lowStream.pc && lowStream.pc.pc) {
        lowStream.pc.pc.getStats(null).then(stats => {
          stats.forEach(report => {
            if (report.type === "outbound-rtp" && report.kind === "video") {
              //Object.keys(report).forEach(statName => { console.log(`LOW OUTBOUND ${statName}: ${report[statName]}`); });
              if (report["framesPerSecond"]) {
                this.outboundFPSLow = report["framesPerSecond"];
              }
              if (report["framesEncoded"]) {
                if (timedelta > 0) {
                  this.outboundFPSLow2 = Math.floor(1000 * (report["framesEncoded"] - this.outboundFrameCountLow) / timedelta);
                }
                this.outboundFrameCountLow = report["framesEncoded"];
              }
            }
          })
        });
      }
    }

    if (this.myPublishClient > -1 && this.clients[this.myPublishClient] && this.clients[this.myPublishClient]._highStream) {
      var highStream = this.clients[this.myPublishClient]._highStream;

      var videoStats = this.clients[this.myPublishClient].getLocalVideoStats();
      this.outboundWidth = videoStats.sendResolutionWidth;
      this.outboundHeight = videoStats.sendResolutionHeight;
      this.outboundBitrate = Math.floor(videoStats.sendBitrate / 1000);

      if (highStream.pc && highStream.pc.pc) {
        highStream.pc.pc.getStats(null).then(stats => {
          stats.forEach(report => {
            if (report.type === "outbound-rtp" && report.kind === "video") {
              //Object.keys(report).forEach(statName => { console.log(`HIGH OUTBOUND ${statName}: ${report[statName]}`); });
              if (report["framesPerSecond"]) {
                this.outboundFPSHigh = report["framesPerSecond"];
              }
              if (report["framesEncoded"]) {
                if (timedelta > 0) {
                  this.outboundFPSHigh2 = Math.floor(1000 * (report["framesEncoded"] - this.outboundFrameCountHigh) / timedelta);
                }
                this.outboundFrameCountHigh = report["framesEncoded"];
              }
            }
          })
        });
      }
    }

    // if the frames being encoded is less than expected 
    // i.e. less than the top end
    // then relay this to the group to avoid them limiting their remote video count

    var localFPS = 0;
    if (this.outboundFPSHigh2 > 0) {
      localFPS = this.outboundFPSHigh2;
    }
    if (this.outboundFPSLow2 > 0 && this.outboundFPSLow2 < localFPS) {
      localFPS = this.outboundFPSLow2;
    }

    if (localFPS > 0 && localFPS < this.FPSThresholdToIncreaseSubs * this.maxFPS) {
      var msg = this.FPS + ':' + this.myUid[this.myPublishClient] + ":" + localFPS;
      this.rtmChannel.sendMessage({ text: msg }).then(() => {
        //console.log('AgoraRTM FPS send success :' + msg);
      }).catch(error => {
        console.log('AgoraRTM FPS send failure');
      });
    }
  }

  doSwitchRxVideoStreamTypeAt() {
    var subs = this.getMapSize(this.videoSubscriptions);
    if (subs > this.SwitchVideoStreamTypeAt && this.defaultVideoStreamType == this.HighVideoStreamType) {
      this.defaultVideoStreamType = this.LowVideoStreamType;
      this.changeVideoStreamType(this.defaultVideoStreamType);
    } else if (subs < this.SwitchVideoStreamTypeAt && this.defaultVideoStreamType != this.HighVideoStreamType) {
      this.defaultVideoStreamType = this.HighVideoStreamType;
      this.changeVideoStreamType(this.defaultVideoStreamType);
    }
  }

  changeVideoStreamType(streamType) {
    var that = this;
    Object.keys(this.videoSubscriptions).forEach(async function (key) {
      var user = that.userMap[key];
      var client = that.videoPublishers[key];
      client.setRemoteVideoStreamType(user.uid, streamType);
    });

  }

  useCallStatsToAdjustNumberOfSubscriptions() {

    // based on remote and local FPS for each client we can determine if the number of remote videos can be
    // increased, held or decreased.
    var renderFrameRateSum = 0;
    var renderFrameRateAvg = 0;
    var StatMinStart = 1000000;
    var renderFrameRateMin = StatMinStart;
    var renderFrameRateCount = 0;
    var uidKeyCount = 0;

    var remotesIncrease = 0;
    var remotesDecrease = 0;
    var remotesHold = 0;


    var packetLossAvg = 0;
    var packetLossMax = 0;
    var packetLossMin = StatMinStart;
    var packetLossCount = 0;
    var freezeRateAvg = 0;
    var freezeRateMax = 0;
    var freezeRateCount = 0;
    var end2EndDelayAvg = 0;
    var end2EndDelayMax = 0;
    var end2EndDelayCount = 0;

    this.getOutboundStats();

    for (var i = 0; i < this.numClients; i++) {
      var client = this.clients[i];
      if (!client._users.length) {
        continue;
      }

      // WebRTC Inbound Stats Per Client - Keep as useful to know how to get
      // START INBOUND STATS EXAMPLE 
      /*
      if (client._remoteStream && this.debugInboundStats++ > 25) {
        this.debugInboundStats = 0;

        for (var u = 0; u < client._users.length; u++) {
          var uid = client._users[u].uid;
          var rc = client._remoteStream.get(uid);
          if (rc) {
            if (rc.pc && rc.pc.pc) {
              rc.pc.pc.getStats(null).then(stats => {
                stats.forEach(report => {
                  if (report.type === "inbound-rtp" && report.kind === "video") {
                    // if (report["framesDropped"])
                    //  console.log(" framesDropped " + report["framesDropped"]);
                    Object.keys(report).forEach(statName => { console.log(`inbound-rtp video for ${uid}  ${statName}: ${report[statName]}`); });
                  }
                  if (report.type === "inbound-rtp" && report.kind === "audio") {
                    Object.keys(report).forEach(statName => { console.log(`inbound-rtp audio for ${uid}  ${statName}: ${report[statName]}`); });
                  }
                })
              });
            }
          }
        }
      } 
      */
      
      // END INBOUND STATS EXAMPLE 


      var rvs = client.getRemoteVideoStats();
      if (rvs) {
        var rvskeys = Object.keys(rvs);
        for (var k = 0; k < rvskeys.length; k++) {
          uidKeyCount++;
          // console.log("stats for "+ rvskeys[k]+" rfr  "+rvs[rvskeys[k]]["renderFrameRate"]);
          if (rvs[rvskeys[k]]["renderFrameRate"]) {


            var rfr = rvs[rvskeys[k]]["renderFrameRate"];
            // console.log("remote FPS for "+rvskeys[k]+" "+this.fpsMap[rvskeys[k]]+" render rate"+rfr);
            var expectedFPS = this.maxFPS;
            if (this.fpsMap[rvskeys[k]]) {
              expectedFPS = this.fpsMap[rvskeys[k]];
            }
            // examine render rate of remote
            // if zero then its not properly connected.
            if (rfr == 0) {
              remotesHold++;
            }
            else if (rfr > expectedFPS * this.FPSThresholdToIncreaseSubs) {
              remotesIncrease++;
            } else if (rfr < expectedFPS * this.FPSThresholdToReduceSubs) {
              remotesDecrease++;
            } else {
              remotesHold++;
            }

            renderFrameRateSum = renderFrameRateSum + rfr;
            if (rfr < renderFrameRateMin) {
              renderFrameRateMin = rfr;
            }
            renderFrameRateCount++;
          }

          if (this.superOptimise !== "true" && !isMobile()) {
            if (rvs[rvskeys[k]]["packetLossRate"]) {
              packetLossCount++;
              packetLossAvg = packetLossAvg + rvs[rvskeys[k]]["packetLossRate"];
              if (rvs[rvskeys[k]]["packetLossRate"] > packetLossMax) {
                packetLossMax = rvs[rvskeys[k]]["packetLossRate"];
              }
              if (rvs[rvskeys[k]]["packetLossRate"] < packetLossMin) {
                packetLossMin = rvs[rvskeys[k]]["packetLossRate"];
              }
            }

            if (rvs[rvskeys[k]]["freezeRate"]) {
              freezeRateCount++;
              freezeRateAvg = freezeRateAvg + rvs[rvskeys[k]]["freezeRate"];
              if (rvs[rvskeys[k]]["freezeRate"] > freezeRateMax) {
                freezeRateMax = rvs[rvskeys[k]]["freezeRate"];
              }
            }

            // avoid crazy outliers
            if (rvs[rvskeys[k]]["end2EndDelay"] && rvs[rvskeys[k]]["end2EndDelay"] < 1000) {
              end2EndDelayCount++;
              end2EndDelayAvg = end2EndDelayAvg + rvs[rvskeys[k]]["end2EndDelay"];
              if (rvs[rvskeys[k]]["end2EndDelay"] > end2EndDelayMax) {
                end2EndDelayMax = rvs[rvskeys[k]]["end2EndDelay"];
              }
            }
          }
        }
      }
    }

    if (renderFrameRateCount > 0) {
      renderFrameRateAvg = Math.floor(renderFrameRateSum / renderFrameRateCount);
    }

    if (packetLossCount > 0) {
      packetLossAvg = Math.floor(packetLossAvg / packetLossCount);
    }

    if (freezeRateCount > 0) {
      freezeRateAvg = Math.floor(freezeRateAvg / freezeRateCount);
    }

    if (end2EndDelayCount > 0) {
      end2EndDelayAvg = Math.floor(end2EndDelayAvg / end2EndDelayCount);
    }


    //console.log("avg renderFrameRate " + renderFrameRate);
    if (!renderFrameRateAvg) {
      //console.log("NAN renderFrameRateAvg " + renderFrameRateAvg);
    }

    if (renderFrameRateMin == StatMinStart) {
      renderFrameRateMin = -1;
    }
    if (packetLossMin == StatMinStart) {
      packetLossMin = -1;
    }

    var subs = this.getMapSize(this.videoSubscriptions);
    if (subs > 1 && renderFrameRateCount < (subs - 1)) { // account for missing render rates
      remotesDecrease = remotesDecrease + ((subs - 1) - renderFrameRateCount);
    }

    // increase the number of subscriptions while conditions remain perfect 
    if (this.rampUpAgressive === "true" && remotesIncrease > (remotesDecrease + remotesHold)) {
      //this.numRenderExceed++;
      this.numRenderExceed++;
    }
    //  else if (remotesIncrease > 0 && remotesDecrease == 0 && remotesHold < (remotesIncrease / 10)) {
    else if (remotesIncrease > 0 && ((remotesIncrease / 7) > (remotesDecrease + remotesHold))) {
      this.numRenderExceed++;
    } // reduce the number of subscriptions when the majority of streams are failing to keep up.
    else if (subs > 0 && remotesDecrease > (remotesHold + remotesIncrease) / 2) {
      this.numRenderExceed--;
    }

    if (this.numRenderExceed >= this.numRenderExceedToIncrease || this.dictionaryLength(this.videoSubscriptions) == 0) {
      this.numRenderExceed = 0;
      // increase VIDEO allow subs
      if (this.allowedVideoSubs <= (this.getMaxVideoTiles() - this.allowedVideoSubsIncreaseBy) && this.allowedVideoSubs <= (this.dictionaryLength(this.videoPublishers) - this.allowedVideoSubsIncreaseBy) && this.allowedVideoSubs < (this.dictionaryLength(this.videoSubscriptions) + this.allowedVideoSubsIncreaseBy)) {
        this.allowedVideoSubs = this.allowedVideoSubs + this.allowedVideoSubsIncreaseBy;
      } else if (this.allowedVideoSubs <= (this.getMaxVideoTiles() - 1) && this.allowedVideoSubs <= (this.dictionaryLength(this.videoPublishers) - 1) && this.allowedVideoSubs < (this.dictionaryLength(this.videoSubscriptions) + 1)) {
        this.allowedVideoSubs = this.allowedVideoSubs + 1;
      }
      // increase AUDIO allow subs
      if (this.allowedAudioSubs < this.maxAudioSubscriptions && this.allowedAudioSubs < (this.dictionaryLength(this.audioSubscriptions) + 1)) {
        this.allowedAudioSubs = this.dictionaryLength(this.audioSubscriptions) + 1;
      }
    } else if (this.numRenderExceed <= this.numRenderExceedToDecrease) {
      this.numRenderExceed = 0;
      // reduce VIDEO allowed subs
      if (this.allowedVideoSubs - this.allowedVideoSubsDecreaseBy >= this.minVideoAllowedSubs) {
        this.allowedVideoSubs = this.allowedVideoSubs - this.allowedVideoSubsDecreaseBy;
      } else if (this.allowedVideoSubs > this.minVideoAllowedSubs) {
        this.allowedVideoSubs--;
      }
      // reduce AUDIO allowed subs
      if (this.allowedAudioSubs > this.minAudioAllowedSubs) {
        this.allowedAudioSubs--;
      }
    }

    // display stats in UI
    if (this.superOptimise !== "true" && !isMobile()) {
      var stats = "Render Rate avg:" + renderFrameRateAvg + " min:" + renderFrameRateMin + " cnt:" + renderFrameRateCount + " keys:" + uidKeyCount + " | Packet Loss min:" + Math.round(packetLossMin * 100) / 100 + " max:" + Math.round(packetLossMax * 100) / 100 + " | End-to-End avg:" + Math.round(end2EndDelayAvg * 100) / 100 + " max:" + Math.round(end2EndDelayMax * 100) / 100;
      var stats2 = " Outbound FPS Low:" + this.outboundFPSLow2 + " High:" + this.outboundFPSHigh2 + " | Audio Subs " + this.getMapSize(this.audioSubscriptions) + "/" + this.maxAudioSubscriptions + "(" + this.audioPublishersByPriority.length + ")" + " | Video Subs " + this.getMapSize(this.videoSubscriptions) + "/" + this.getMaxVideoTiles() + "(" + this.allowedVideoSubs + "/" + this.videoPublishersByPriority.length + ")" + " | Inc:" + remotesIncrease + " Dec:" + remotesDecrease + " Hold:" + remotesHold;
      document.getElementById("renderFrameRate").innerHTML = stats + "<br/>" + stats2;
    } else {
      var stats = " Inc:" + remotesIncrease + " Dec:" + remotesDecrease + " Hold:" + remotesHold;
      var stats2 = this.outboundWidth + "x" + this.outboundHeight + " " + this.outboundFPSHigh2 + "fps " + this.outboundBitrate + "kbps";
      document.getElementById("renderFrameRate").innerHTML = stats + "<br/>" + stats2;
    }

    if (this.enableFullLogging === "true") {
      var stats = "Render Rate avg:" + renderFrameRateAvg + " min:" + renderFrameRateMin + " cnt:" + renderFrameRateCount + " keys:" + uidKeyCount + " | Packet Loss min:" + Math.round(packetLossMin * 100) / 100 + " max:" + Math.round(packetLossMax * 100) / 100 + " | End-to-End avg:" + Math.round(end2EndDelayAvg * 100) / 100 + " max:" + Math.round(end2EndDelayMax * 100) / 100;
      var stats2 = " Outbound FPS Low:" + this.outboundFPSLow2 + " High:" + this.outboundFPSHigh2 + " | Audio Subs " + this.getMapSize(this.audioSubscriptions) + "/" + this.maxAudioSubscriptions + "(" + this.audioPublishersByPriority.length + ")" + " | Video Subs " + this.getMapSize(this.videoSubscriptions) + "/" + this.getMaxVideoTiles() + "(" + this.videoPublishersByPriority.length + ")" + " | Inc:" + remotesIncrease + " Dec:" + remotesDecrease + " Hold:" + remotesHold;
      console.log((new Date()).toLocaleTimeString() + " " + stats + " " + stats2 + " numRenderExceed=" + this.numRenderExceed);
    }
  }

  // web is square
  getGridColCount(cells) {
    if (cells < 2 || (this.gridLayout && cells < 3)) {
      return 1;
    } else if (cells < 5) {
      return 2;
    } else if (cells < 10) {
      return 3;
    } else if (cells < 17) {
      return 4;
    } else if (cells < 26) {
      return 5;
    } else if (cells < 37) {
      return 6;
    } else if (cells < 50) {
      return 7;
    } else if (cells < 65) {
      return 8;
    } else if (cells < 82) {
      return 9;
    } else {
      return 10;
    }
  }

  setMobileOneTime() {
    if (!this.mobileUIUpdated && isMobile()) {
      this.mobileUIUpdated = true;
      document.getElementById("cam_off").classList.add("default_icon_left_mobile");
      document.getElementById("mic_on").classList.add("default_icon_left_mobile");
      document.getElementById("mic_off").classList.add("default_icon_left_mobile");
      document.getElementById("cam_on").classList.add("default_icon_left_mobile");

      document.getElementById("stats_button").classList.add("default_icon_right_mobile");
      document.getElementById("settings_button").classList.add("default_icon_right_mobile");
      //document.getElementById("main_body").classList.add("main_body_mobile");
      

      if (document.getElementById("play_controls")) {
        document.getElementById("play_controls").classList.add("default_icon_left_mobile");
      }

      if (document.getElementById("watchid")) {
        document.getElementById("watchid").classList.add("watch_input_mobile");
      }

    }
  }


  updateUILayout() {

    this.setMobileOneTime();
    this.removeAgoraInnerVideoStyling();

    var height = window.innerHeight;
    var width = window.innerWidth;
    if (height > width) {
      this.landscape = false;
    } else {
      this.landscape = true;
    }

    // shownPersonToPerson is 2 person face time style call
    // TODO move this to checking after subs
    var video_subs = this.getMapSize(this.videoSubscriptions); 
    if (video_subs == 1 && this.gridLayout && !this.shareContentOnDisplay) {
      this.shownPersonToPerson = true;
      this.toggleLayout(true);
    } else if (video_subs != 1 && this.shownPersonToPerson && !this.gridLayout && !this.shareContentOnDisplay) {
      this.shownPersonToPerson = false;
      this.toggleLayout();
    }


    var cell_width = this.CellWidthBase;
    var cell_height = this.CellHeightBase;
    var cell_margin = 4;
    var grid_padding = 6;
    var toolbar_height = document.getElementById("toolbar").offsetHeight;
    var toolbar_height_and_focus_height = toolbar_height;




    var cells = document.getElementsByClassName('remote_video'); // in grid (excludes focussed follow speaker)
    var cellCount = cells.length;
    if (agoraApp.localTracks.videoTrack && agoraApp.localTracks.videoTrack._enabled) {
      cellCount = cellCount + 1;
    }

    var cols = this.getGridColCount(cellCount);
    var rows = Math.ceil(cellCount / cols);

    // less square on mobile
    if (isMobile() && cols > 2) {
      if (this.landscape) {
        if (cellCount < 16) {
          rows = 2;
        }
        else if (cellCount < 24) {
          rows = 3;
        } else {
          rows = 4; 
        }
        cols = Math.ceil(cellCount / rows);
      } else {
        if (cellCount< 16) { // portrait and fewer than 16
          cols = 2;
        }
        else if (cellCount < 24) {
          cols = 3;
        }
        else {
          cols = 4;
        }
        rows = Math.ceil(cellCount / cols);
      }
    }

    //  follow speaker/content mode
    if (!this.gridLayout) { //
      // keep single row

      // portrait mobile can handle up to 3 rows of 2
      if (isMobile()) {
        if (!this.landscape) { // portrait
          if (cellCount>6) {
            rows=2;
          }
        } else {  // landscape
          rows=1; 
        }
      } else {
        rows = 1;
        if (cellCount>6) {
          rows = 2;
        }
      }
        
     
      cols = Math.ceil(cellCount / rows);
      if (video_subs == 1 && !this.shareContentOnDisplay) {  // handle two people - me and one other
        var focus_height = height - toolbar_height - grid_padding * 3;
        var focus_width = width - (grid_padding * 2);
        document.getElementById("focus-video").style.height = focus_height + 'px';
        document.getElementById("focus-video").style.width = focus_width + 'px';
        toolbar_height_and_focus_height = toolbar_height + focus_height;
        rows=1;
        cols = 1;
      }
      else if (this.landscape) {
        var focus_height = height - toolbar_height - cell_height * 2 - cell_margin * 3 - grid_padding * 3;
        if (focus_height < 180)
          focus_height = 180;
        document.getElementById("focus-video").style.height = focus_height + 'px';
        document.getElementById("focus-video").style.width = focus_height * this.AspectRatio + 'px';
        toolbar_height_and_focus_height = toolbar_height + focus_height; //document.getElementById("focus-video").offsetHeight;
      } else {
        var focus_width = width - (grid_padding * 2);
        if (focus_width < 320)
          focus_width = 320;
        document.getElementById("focus-video").style.height = focus_width / this.AspectRatio + 'px';
        document.getElementById("focus-video").style.width = focus_width + 'px';
        toolbar_height_and_focus_height = toolbar_height + focus_width / this.AspectRatio; //document.getElementById("focus-video").offsetHeight;
      }
    }

    document.getElementById("agoravideoplayer").style.height = document.getElementById("focus-video").style.height;
    document.getElementById("agoravideoplayer").style.width = document.getElementById("focus-video").style.width;

    var toolbar_width = 0;

    // mobile special layouts
    /*
    if (isMobile()) {
      
      //TODOX for mobile in landscape put back to grid mode (if not share content or shownPersonToPerson)
      if (!this.gridLayout && this.landscape && !this.shareContentOnDisplay && video_subs != 1) {
        this.toggleLayout();
      }

      if (this.landscape && rows > 1) {
        this.mobileUIUpdatedLandscape = true;
        this.mobileUIUpdatedPortrait = false;
        toolbar_width = 120;
        var that = this;
        var els = document.getElementsByClassName("default_icon");
        Array.prototype.forEach.call(els, function (el) {
          if (!el.classList.contains("hidden"))
            el.classList.add("default_icon_mobile_landscape");
        });
        document.getElementById("main_body").classList.add("main_body_mobile_landscape");
        document.getElementById("media_controls").classList.add("media_controls_mobile_landscape");
        document.getElementById("settings_controls").classList.add("hidden");
        document.getElementById("stats_container").classList.add("hidden")
        document.getElementById("toolbar").classList.remove("headerOpen");
        // document.getElementById("stats_container").classList.add("hidden");

      } else {
        this.mobileUIUpdatedLandscape = false;
        this.mobileUIUpdatedPortrait = true;
        var els = document.getElementsByClassName("default_icon");
        Array.prototype.forEach.call(els, function (el) {
          el.classList.remove("default_icon_mobile_landscape");
        });
        document.getElementById("main_body").classList.remove("main_body_mobile_landscape");
        document.getElementById("media_controls").classList.remove("media_controls_mobile_landscape");
        document.getElementById("settings_controls").classList.remove("hidden");
        // document.getElementById("stats_container").classList.remove("hidden");
      }
    }*/

    // mobile grid gaps
    if (isMobile()) {
      var mel= document.getElementById("main_body");
      if (!this.landscape) { // portrait
       if (!mel.classList.contains("main_body_mobile_portrait")) {
        mel.classList.add("main_body_mobile_portrait")
       }
       if (mel.classList.contains("main_body_mobile_landscape")) {
        mel.classList.remove("main_body_mobile_landscape")
       }
      } else {  // landscape
        if (!mel.classList.contains("main_body_mobile_landscape")) {
          mel.classList.add("main_body_mobile_landscape")
         }
         if (mel.classList.contains("main_body_mobile_portrait")) {
          mel.classList.remove("main_body_mobile_portrait")
         }
      }
    }


    document.getElementById("grid").style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";

    var grid_available_height = height - toolbar_height_and_focus_height - (grid_padding * (rows + 1));
    var grid_available_width = width - toolbar_width - (grid_padding * cols);

    if (video_subs == 1 && !this.gridLayout && !this.shareContentOnDisplay) { // 1 other person to display larger
      document.getElementById("grid").classList.add("grid_over");
      grid_available_height = 90;
    } else {
      document.getElementById("grid").classList.remove("grid_over");
    }
    // are we limited by width or height 
    if (rows * grid_available_width / this.AspectRatio > cols * grid_available_height) {
      // height constrained
      cell_height = (grid_available_height - ((rows - 1) * cell_margin)) / rows;
      cell_width = cell_height * (this.AspectRatio);
    } else {
      // width constrained
      cell_width = (grid_available_width - ((cols - 1) * cell_margin)) / cols;
      if (!this.gridLayout && cell_width < this.CellWidthBase) {
        cell_width = this.CellWidthBase;
      }
      cell_height = cell_width / (this.AspectRatio);
    }

    for (var i = 0; i < (cells.length); i++) {
      if (cells[i]) {
        cells[i].style.width = cell_width + 'px';
        cells[i].style.height = cell_height + 'px';
        cells[i].classList.remove("hidden");
      }
    }

    // dont understand this 
    for (var i = cells.length; i < cells.length; i++) {
      cells[i].classList.add("hidden");
    }

    var grid_width = (cell_width * cols) + ((cols) * cell_margin);
    var grid_height = (cell_height * rows) + ((rows) * cell_margin);
    if (grid_width > width) {
      grid_width = width;
    }

    document.getElementById("grid").style.width = grid_width + 'px';
    document.getElementById("grid").style.height = grid_height + 'px';

    var grid_actual_width = document.getElementById("grid").offsetWidth;
    var grid_actual_height = document.getElementById("grid").offsetHeight;
    
    if (1==3 && this.landscape && isMobile() && rows > 1 &&  !this.shareContentOnDisplay) {
      document.getElementById("grid").style.marginTop = (height - grid_actual_height) / 2 + 'px';
      document.getElementById("grid").style.marginLeft = '0px';
      document.getElementById("media_controls").style.marginTop = ((height / 2) - 100) + 'px';
    }
    else if (1==3 && this.landscape && isMobile() &&  !this.shareContentOnDisplay) {
      document.getElementById("grid").style.marginTop = (height - grid_actual_height - toolbar_height_and_focus_height) / 2 + 'px';
      document.getElementById("grid").style.marginLeft = '0px';
      document.getElementById("media_controls").style.marginTop = '0px';
    }
    else {
      document.getElementById("grid").style.marginTop = '0px';
      document.getElementById("grid").style.marginLeft = ((width - grid_actual_width) / 2) - (cell_margin + 1) + 'px';
      document.getElementById("media_controls").style.marginTop = '0px';
    }

    document.getElementById("local-player").style.width = cell_width + 'px';
    document.getElementById("local-player").style.height = cell_height + 'px';

    if (document.getElementById(this.vadUid) && this.gridLayout) {
      document.getElementById(this.vadUid).classList.add("remote_video_active");
      if (document.getElementById(this.vadUid).children[0]) {
        document.getElementById(this.vadUid).children[0].style.backgroundColor = "";
        document.getElementById(this.vadUid).children[0].style.opacity = "";
      }
    }
  }
}

function toggleSettings() {
  showMediaDeviceChange();
}

function publishScreenShareToChannel() {
  agoraApp.publishScreenShareToChannel();
}

function hideStats() {
  if (!document.getElementById("stats_container").classList.contains("hidden")) {
    document.getElementById("stats_container").classList.add("hidden")
    document.getElementById("toolbar").classList.remove("headerOpen");
  }
}

function toggleStats() {
  if (document.getElementById("stats_container").classList.contains("hidden")) {
    document.getElementById("stats_container").classList.remove("hidden");
    document.getElementById("toolbar").classList.add("headerOpen");
  } else {
    document.getElementById("stats_container").classList.add("hidden")
    document.getElementById("toolbar").classList.remove("headerOpen");
  }
}

function toggleCam() {
  if (!agoraApp.localTracks.videoTrack) {
    AgoraRTC.getCameras();
    let targetClientIndex = agoraApp.getFirstOpenChannel();
    agoraApp.publishVideoToChannel();
    document.getElementById("local-player").classList.remove("hidden");
    document.getElementById("cam_on").classList.add("hidden");
    document.getElementById("cam_off").classList.remove("hidden");
    return;
  }
  if (agoraApp.localTracks.videoTrack._enabled) {
    agoraApp.localTracks.videoTrack.setEnabled(false);
    document.getElementById("local-player").classList.add("hidden");
    document.getElementById("cam_on").classList.remove("hidden");
    document.getElementById("cam_off").classList.add("hidden");
  }
  else {
    agoraApp.localTracks.videoTrack.setEnabled(true);
    document.getElementById("local-player").classList.remove("hidden");
    document.getElementById("cam_on").classList.add("hidden");
    document.getElementById("cam_off").classList.remove("hidden");
  }
}

function toggleLayout() {
  agoraApp.toggleLayout(true);
}

function toggleMic() {
  if (!agoraApp.localTracks.audioTrack) {
    AgoraRTC.getMicrophones();
    let targetClientIndex = agoraApp.getFirstOpenChannel();
    agoraApp.publishAudioToChannel(null, targetClientIndex);
    document.getElementById("mic_on").classList.add("hidden");
    document.getElementById("mic_off").classList.remove("hidden");
    return;
  }

  if (agoraApp.localTracks.audioTrack._enabled) {

    agoraApp.localTracks.audioTrack.setEnabled(false);
    
    if (agoraApp.vadUid=="local-player") { 
      document.getElementById(agoraApp.vadUid).classList.remove("remote_video_active");
      agoraApp.vadUid=null;
    }
  
    document.getElementById("mic_off").classList.add("hidden");
    document.getElementById("mic_on").classList.remove("hidden");
  }
  else {
    agoraApp.localTracks.audioTrack.setEnabled(true);
    document.getElementById("mic_on").classList.add("hidden");
    document.getElementById("mic_off").classList.remove("hidden");
  }
}


let agoraApp = new AgoraMultiChanelApp();

function getParameterByName(name, url = window.location.href) {
  name = name.replace(/[\[\]]/g, '\\$&');
  var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
    results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function getParameterByNameAsInt(name, url = window.location.href) {
  var val = getParameterByName(name, url);
  if (val) return parseInt(val, 10);
  return val;
}

function resizeGrid() {
  agoraApp.updateUILayout();
}

function isMobile() {
  try {
    if (agoraApp && agoraApp.isMobile === "true") {
      return true;
    }
  } catch (e) { }


  if ((getParameterByName("isMobile") || "false") === "true") {
    return true;
  }
  return (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent))
}


function isIOS() {
  return (/iPhone|iPad|iPod/i.test(navigator.userAgent))
}

function isChromeIOS() {
  //return true;
  return false;
  //return (/CriOS/i.test(navigator.userAgent))
}

async function switchCamera(label) {
  currentCam = cams.find(cam => cam.label === label);
  $(".cam-input").val(currentCam.label);
  // switch device of local video track.
  agoraApp.cameraId = currentCam.deviceId;
  await agoraApp.localTracks.videoTrack.setDevice(currentCam.deviceId);
}

async function switchMicrophone(label) {
  currentMic = mics.find(mic => mic.label === label);
  $(".mic-input").val(currentMic.label);
  // switch device of local audio track.
  agoraApp.micId = currentMic.deviceId;
  await agoraApp.localTracks.audioTrack.setDevice(currentMic.deviceId);
}

async function switchSpeaker(label, deviceId) {
  $(".speaker-input").val(label);
  // switch device of local audio track.
  await agoraApp.localTracks.audioSourceTrack.setPlaybackDevice(deviceId);
}

function setVolumeWave() {
  volumeAnimation = requestAnimationFrame(setVolumeWave);
  $(".progress-bar").css("width", agoraApp.localTracks.audioTrack.getVolumeLevel() * 100 + "%")
  $(".progress-bar").attr("aria-valuenow", agoraApp.localTracks.audioTrack.getVolumeLevel() * 100)
}

function showLoadingSpinner() {
  document.getElementById("spinner").classList.remove("hidden");
}

function hideLoadingSpinner() {
  document.getElementById("spinner").classList.add("hidden");
}

function selectBestCam(cams) {
  for (var i = 0; i < cams.length; i++) {
    if (cams[i].label.indexOf("FaceTime") == 0) {
      return i;
    }
  }
  // usually first in the list 
  // unless its Facetime 
  return 0;
}

let volumeAnimation;

async function showMediaDeviceTest() {

  await agoraApp.loadDevices();

  agoraApp.localTracks.videoTrack.play("pre-local-player");
  agoraApp.removeAgoraInnerVideoStyling();
  $("#media-device-test").modal("show");
  $(".cam-list").delegate("a", "click", function (e) {
    switchCamera(this.text);
  });
  $(".mic-list").delegate("a", "click", function (e) {
    switchMicrophone(this.text);
  });

  // get mics
  mics = await AgoraRTC.getMicrophones();
  currentMic = mics[0];
  $(".mic-input").val(currentMic.label);
  mics.forEach(mic => {
    $(".mic-list").append(`<a class="dropdown-item" href="#">${mic.label}</a>`);
  });

  // get cameras
  cams = await AgoraRTC.getCameras();
  //currentCam = cams[0];
  currentCam = cams[selectBestCam(cams)];
  $(".cam-input").val(currentCam.label);
  cams.forEach(cam => {
    $(".cam-list").append(`<a class="dropdown-item" href="#">${cam.label}</a>`);
  });


  $("#media-device-test").on("hidden.bs.modal", async function (e) {
    cancelAnimationFrame(volumeAnimation);
    showLoadingSpinner();
    await agoraApp.init();

    var currentCam = cams.find(cam => cam.label === $(".cam-input").val());
    var currentMic = mics.find(mic => mic.label === $(".mic-input").val());


    await agoraApp.localTracks.videoTrack.setDevice(currentCam.deviceId);
    await agoraApp.localTracks.audioTrack.setDevice(currentMic.deviceId);
    await agoraApp.startCamMic(currentCam.deviceId, currentMic.deviceId);

    hideLoadingSpinner();
  })

  volumeAnimation = requestAnimationFrame(setVolumeWave);

  // without setting it like this you can't be sure you are using the correct device 
  agoraApp.cameraId = currentCam.deviceId;
  agoraApp.micId = currentMic.deviceId;

}

async function showMediaDeviceChange() {
  $("#mediaGo").html("Close");
  $("#media-device-test").modal("show");
  $("#media-device-test").unbind("hidden.bs.modal");
  $("#media-device-test").on("hidden.bs.modal", async function (e) {
    await agoraApp.localTracks.videoTrack.setDevice(currentCam.deviceId);
    await agoraApp.localTracks.audioTrack.setDevice(currentMic.deviceId);
  });
}

async function connect() {
  await agoraApp.init();
  await agoraApp.startCamMic();
}

window.addEventListener('resize', resizeGrid);

var showDeviceSelection = getParameterByName("showDeviceSelection") || "true";

if (showDeviceSelection === "true" && !isChromeIOS()) {
  showMediaDeviceTest();
} else {
  connect();
}

var autoShowStats = getParameterByName("autoShowStats") || "false";
if (autoShowStats === "true") {
  toggleStats();
}

