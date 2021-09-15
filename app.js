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
    this.STOP_SCREENSHARE = "STOP_SCREENSHARE";
    this.INCREASE_RESOLUTION = "INCREASE_RESOLUTION";

    this.VIDEO = "video";
    this.AUDIO = "audio";

    this.AspectRatio = 16 / 9;

    // Page Parameters
    this.appId = getParameterByName("appid") || "20b7c51ff4c644ab80cf5a4e646b0537";
    this.baseChannelName = getParameterByName("channelBase") || "SA-MULTITEST";
    this.maxClients = getParameterByNameAsInt("maxClients") || 4;
    this.maxUsersPerChannel = getParameterByNameAsInt("maxUsersPerChannel") || 16;
    this.isMobile = getParameterByName("isMobile") || "false";
    this.maxVideoTiles = getParameterByNameAsInt("maxVideoTiles") || ((this.isMobile === "true" || isMobile()) ? 16 : 49);
    this.maxAudioSubscriptions = getParameterByNameAsInt("maxAudioSubscriptions") || 6;
    this.minVideoAllowedSubs = getParameterByNameAsInt("minVideoAllowedSubs") || 1;
    this.initialAudioAllowedSubs = getParameterByNameAsInt("initialAudioAllowedSubs") || 3;
    this.initialVideoAllowedSubs = getParameterByNameAsInt("initialVideoAllowedSubs") || ((this.isMobile === "true" || isMobile()) ? 1 : 16);
    this.minAudioAllowedSubs = getParameterByNameAsInt("minAudioAllowedSubs") || 3;
    this.intervalManageSubscriptions = getParameterByNameAsInt("intervalManageSubscriptions") || 150;
    this.numRenderExceedToIncrease = getParameterByNameAsInt("numRenderExceedToIncrease") || 2;
    this.allowedVideoSubsIncreaseBy = getParameterByNameAsInt("allowedVideoSubsIncreaseBy") || ((this.isMobile === "true" || isMobile()) ? 2 : 3);
    this.numRenderExceedToDecrease = getParameterByNameAsInt("numRenderExceedToDecrease") || -6;
    this.allowedVideoSubsDecreaseBy = getParameterByNameAsInt("allowedVideoSubsDecreaseBy")  || ((this.isMobile === "true" || isMobile()) ? 1 : 1);
    this.minRemoteStreamLife = getParameterByNameAsInt("minRemoteStreamLife") || 6 * 1000;
    // number of subscriptions before moving to low stream
    this.switchVideoStreamTypeAt = getParameterByNameAsInt("switchVideoStreamTypeAt") || ((this.isMobile === "true" || isMobile()) ? 1 : 6);

    this.rampUpAgressive = getParameterByName("rampUpAgressive") || "false";
    this.dynamicallyAdjustLowStreamResolution = getParameterByName("dynamicallyAdjustLowStreamResolution") || "false";
    // disable subscriptions for load testing clients 
    this.performSubscriptions = getParameterByName("performSubscriptions") || "true";
    this.muteMicOnJoin = getParameterByName("muteMicOnJoin") || "true";
    this.sendVAD = getParameterByName("sendVAD") || "true";
    this.enableFullLogging = getParameterByName("enableFullLogging") || "false";
    this.enableContentSpeakerMode = getParameterByName("enableContentSpeakerMode") || "true";

    this.enableRemoteCallStatsMonitor = getParameterByName("enableRemoteCallStatsMonitor") || "true";
    this.enableCallStatsToAdjustNumberOfSubscriptions = getParameterByName("enableCallStatsToAdjustNumberOfSubscriptions") || "false";
    this.forceRemoteUserStats = getParameterByName("forceRemoteUserStats") || "false";
    this.showMinStats = getParameterByName("showMinStats") || "false";

    this.superOptimise = getParameterByName("superOptimise") || "false";
    this.mobileShowHighQualityAtStart = getParameterByName("mobileShowHighQualityAtStart") || "true";
    this.enableDualStream = getParameterByName("enableDualStream") || "true";
    this.enableHDAdjust = getParameterByName("enableHDAdjust") || "true";
    this.enableHDAdjustiOS = getParameterByName("enableHDAdjustiOS") || "true";

    this.enableDualStreamMobile = getParameterByName("enableDualStreamMobile") || "false";
    this.matchPriorityOrderToAudio  = getParameterByName("matchPriorityOrderToAudio") || "false";

    this.vcodec = getParameterByName("vcodec") || "vp8";

    this.enableDualStream = getParameterByName("enableDualStream") || "true";

    // tokens not used in this sample
    this.token = null;

    // Each agora client connects to one Agora channel
    this.numVideoTiles = 0;

    this.videoSubscriptions = {}; // maps to startTime and streamType and gets count often which is not efficient 
    this.videoSubscriptionsCount = 0; // faster to cache count of map
    this.audioSubscriptions = {}; // maps to client but never used
    this.audioSubscriptionsCount = 0;
    this.videoPublishers = {}; // maps to client 
    this.audioPublishers = {};
    this.videoPublishersCount = 0;
    this.userMap = {};
    this.userRemoteStatsMap = {};

    this.fpsMap = {};
    this.allowedVideoSubs = this.initialVideoAllowedSubs;
    console.log(" this.initialVideoAllowedSubs " + this.initialVideoAllowedSubs)
    this.allowedAudioSubs = this.initialAudioAllowedSubs;
    this.numRenderExceed = 0;
    // first in list is more imporant person 
    this.usersConnected = [];
    this.orderedVideoSubs = []; //  build  subs ordered list (array) for reducing quality as needed
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
    this.clientConfig = { mode: "live", codec: this.vcodec };
    this.lowVideoWidthInitial = getParameterByNameAsInt("lowVideoWidth") || 160; // ||  320;
    this.lowVideoHeightInitial = getParameterByNameAsInt("lowVideoHeight") || 90; // || 180;
    this.lowVideoWidthCurrent = this.lowVideoWidthInitial;
    this.lowVideoHeightCurrent = this.lowVideoHeightInitial;
    this.lowVideoWidthSmall = 160;
    this.lowVideoHeightSmall = 90;

    this.LowVideoStreamType = 1;
    this.HighVideoStreamType = 0;
    this.defaultVideoStreamType = this.HighVideoStreamType;
    this.bwLastIncreaseResolutionRequest = 0;

    // this.LowVideoStreamType;
    // if (this.mobileShowHighQualityAtStart === "true" || !isMobile()) {
    //  this.defaultVideoStreamType = this.HighVideoStreamType;
    // }



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
    this.initialProfile="360p_11";


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
    this.maxScreenshareUID = 100;
    this.minScreenshareUID = 10;
    this.currScreenshareUID = 10;
    this.screenClient;

    // Bandwidth Control
    this.bwLastDecreaseTime = 0;
    this.bwLastDecreaseCount = 0;
    this.bwLastIncreaseTime = 0;
    this.bwLastIncreaseCount = 0;
    this.bwLastMainWindowIdIncreaseTime = 0;
    this.bwLastIncreaseResolutionRequestEnabled = false;

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

    this.clientStats = null;
    this.remoteStatusDurationCache = 0;
    this.remoteStatusCache = 0;
    this.RTCUtilsInitialised = false;


    // check an appid has been passed in
    if (!this.appId) {
      alert("No appid");
      return;
    }
  }

  async init() {
    await this.createClients();
    /*
    setInterval(() => {
     console.log(" BBBB "+agoraApp.clients[0]._users.length+" "+agoraApp.clients[1]._users.length+" "+agoraApp.clients[2]._users.length+" "+agoraApp.clients[3]._users.length);
    }, this.intervalManageSubscriptions);
*/
    await this.joinChannels();
    //
    setInterval(() => {
      this.manageSubscriptions();
    }, this.intervalManageSubscriptions);

    AgoraRTCUtils.setRTCClients(this.clients, this.numClients);
    AgoraRTCUtils.startInboundVolumeMonitor(150); // ms interval

    if (this.enableRemoteCallStatsMonitor === "true") {
      AgoraRTCUtils.startRemoteCallStatsMonitor(500); // ms interval
      AgoraRTCUtilEvents.on("RemoteUserVideoStatistics", agoraApp.processRemoteUserVideoStatistics);
      AgoraRTCUtilEvents.on("ClientVideoStatistics", agoraApp.processAllClientVideoStatistics);
    }

  }

  async initRTCUtils(profile) {

    if (this.enableHDAdjust === "true" || (AgoraRTCUtils.isIOS() && this.enableHDAdjustiOS === "true")) {
      AgoraRTCUtils.startAutoAdjustResolution(this.clients[this.myPublishClient], profile, AgoraRTCUtils.isIOS());
    }

    AgoraRTCUtils.startVoiceActivityDetection(this.localTracks.audioTrack);
    AgoraRTCUtilEvents.on("VoiceActivityDetected", agoraApp.handleVADEvents);
    this.RTCUtilsInitialised = true;
  }


  processAllClientVideoStatistics(clientStats) {

    agoraApp.clientStats = clientStats;

    if (agoraApp.is_Mobile()) {
      agoraApp.displayClientVideoStatisticsMobile(clientStats);
    } else {
      agoraApp.displayClientVideoStatistics(clientStats);
    }

  }

  displayClientVideoStatistics(clientStats) {

    var stats1 = "";

    var agg = clientStats.SumRxAggRes;

    var stats1 = "Receive Stats - Users:" + clientStats.RemoteSubCount +
      " AggRes:" + agoraApp.fixStat((agg / 720).toFixed(0) + "x" + "720");

    if (clientStats.RemoteSubCount > 0) {
      stats1 = stats1 + agoraApp.getRemoteStatusDisplay(clientStats, "RenderVolAvg:" + agoraApp.fixStat(clientStats.AvgRxRVol.toFixed(0), true) +
        "NackRateAvg:" + agoraApp.fixStat(clientStats.AvgRxNR.toFixed(0), true)) +
        " Duration(s):" + clientStats.RemoteStatusDuration +
        " Bitrate(kbps):" + agoraApp.fixStat((clientStats.RecvBitrate / 1000).toFixed(0));
    }

    var stats2 = "Audio Subs:" + agoraApp.audioSubscriptionsCount + "/" + agoraApp.audioPublishersByPriority.length + "/" + agoraApp.allowedAudioSubs + "/" + agoraApp.maxAudioSubscriptions + " Video Subs:" + agoraApp.videoSubscriptionsCount + "/" + agoraApp.videoPublishersByPriority.length + "/" + agoraApp.allowedVideoSubs + "/" + agoraApp.getMaxVideoTiles();
    var stats3 = "";

    if (clientStats.TxSendResolutionWidth) {
      stats3 = "Transmit Stats - Fps:" + agoraApp.fixStat(clientStats.TxSendFrameRate?.toFixed(0), true) +
        "Profile:" + clientStats.TxProfile +
        //" fpsVol:"+ agoraApp.fixStat(clientStats.TxFpsVol.toFixed(2))+
        " Res:" + agoraApp.fixStat(clientStats.TxSendResolutionWidth + "x" + clientStats.TxSendResolutionHeight) +
        " Bitrate(kbps):" + agoraApp.fixStat(clientStats.TxSendBitratekbps?.toFixed(0));
    }

    document.getElementById("renderFrameRate").innerHTML = stats1 + "<br/>" + stats2 + " " + stats3;
  }

  displayClientVideoStatisticsMobile(clientStats) {

    if (agoraApp.showMinStats==="true") {
      var stats="";
      if (clientStats.RemoteSubCount > 0) {
       stats= agoraApp.getRemoteStatusDisplay(clientStats, "RenderVolAvg:" + agoraApp.fixStat(clientStats.AvgRxRVol.toFixed(0), true) +
      "NackRateAvg:" + agoraApp.fixStat(clientStats.AvgRxNR.toFixed(0), true));
      } else {

      }
      document.getElementById("renderFrameRate").innerHTML = stats;

    } else {
        var agg = clientStats.SumRxAggRes;
        var stats1 =
          "Rx - U: " + clientStats.RemoteSubCount +
          " AggRes:" + agoraApp.fixStat((agg / 720).toFixed(0) + "x" + "720");

        if (clientStats.RemoteSubCount > 0) {
          stats1 = stats1 + agoraApp.getRemoteStatusDisplay(clientStats, "RenderVolAvg:" + agoraApp.fixStat(clientStats.AvgRxRVol.toFixed(0), true) +
            "NackRateAvg:" + agoraApp.fixStat(clientStats.AvgRxNR.toFixed(0), true)) +
            " Dur(s):" + clientStats.RemoteStatusDuration +
            " Br(k):" + agoraApp.fixStat((clientStats.RecvBitrate / 1000).toFixed(0));
        }


        var stats2 = " Audio " + agoraApp.audioSubscriptionsCount + "/" + agoraApp.audioPublishersByPriority.length + "/" + agoraApp.maxAudioSubscriptions + "max | Video " + agoraApp.videoSubscriptionsCount + "/" + agoraApp.videoPublishersByPriority.length + "/" + agoraApp.allowedVideoSubs + "/" + agoraApp.getMaxVideoTiles();
        var elapse= Math.ceil(( Date.now()- clientStats.LastUpdated)/1000);

        stats2=stats2+" "+elapse;
        
        var stats3 = "";
        if (clientStats.TxSendResolutionWidth) {
          stats3 = "Tx - Fps: " + agoraApp.fixStat(clientStats.TxSendFrameRate?.toFixed(0), true) +
            " fpsVol:"+agoraApp.fixStat(clientStats.TxFpsVol.toFixed(2))+
            "Res:" + agoraApp.fixStat(clientStats.TxSendResolutionWidth + "x" + clientStats.TxSendResolutionHeight) +
            "Br(k):" + agoraApp.fixStat(clientStats.TxSendBitratekbps?.toFixed(0));
        }
        //console.log(" "+stats1+" "+stats2+" "+stats3);
        document.getElementById("renderFrameRate").innerHTML = stats1 + "<br/>" + stats2 + stats3;
    }
  }

  getRemoteStatusDisplay(clientStats, display) {
    if (clientStats.RemoteStatus == AgoraRTCUtils.RemoteStatusGood) {
      return "<span class='status_good'>" + display + "</span>";
    } else if (clientStats.RemoteStatus == AgoraRTCUtils.RemoteStatusFair) {
      return "<span class='status_fair'>" + display + "</span>";
    } else if (clientStats.RemoteStatus == AgoraRTCUtils.RemoteStatusPoor) {
      if (clientStats.RemoteStatusExtra == AgoraRTCUtils.RemoteStatusCritical) {
        return "<span class='status_critical'>" + display + "</span>";
      } else {
        return "<span class='status_poor'>" + display + "</span>";
      }
    }
    return "NA";
  }

  fixStat(inp, short) {
    if (short) {
      return " <span class='fixed_stat_short'>" + (inp) + "</span>  ";
    }
    return " <span class='fixed_stat'>" + (inp) + "</span>  ";
  }

  is_Mobile() {
    try {
      if (this.isMobile === "true") {
        return true;
      }
    } catch (e) { }

    return AgoraRTCUtils.isMobile();
  }

  processRemoteUserVideoStatistics(userStats) {


    agoraApp.userRemoteStatsMap[userStats.uid] = userStats;

    var stats_display = document.getElementById(userStats.uid + "_stats_display");
    var sobj = agoraApp.videoSubscriptions[userStats.uid];
    if (stats_display) {
      if (!sobj || (document.getElementById("stats_container").classList.contains("hidden") && agoraApp.forceRemoteUserStats === "false")) {
        stats_display.innerHTML = "";
      } else {
        var stats_display_inner_low = "stats_display_inner_low"; // s

        var sd = "na";

        if (!sobj) {
          console.log(" no userStats.uid " + userStats.uid)
        }

        if (sobj) {
          var streamType = agoraApp.videoSubscriptions[userStats.uid].streamType;

          if (streamType == 1) {
            if (!stats_display.classList.contains(stats_display_inner_low)) {
              stats_display.classList.add(stats_display_inner_low);
            }
          } else {
            if (stats_display.classList.contains(stats_display_inner_low)) {
              stats_display.classList.remove(stats_display_inner_low);
            }
          }

          sd = "high";
          if (streamType == 1) {
            sd = "low";
          }
        }



        stats_display.innerHTML = "<span class='stats_display_inner'> " +
          " Res: " + userStats.receiveResolutionWidth + "x" + userStats.receiveResolutionHeight + " (" + sd + ") " + "<br/> " +
          " Bitrate: " + userStats.receiveBitrate + " <br/> " +
          " Render FPS: " + userStats.renderRateMean.toFixed(0) + " <br/> " +
          " Render Vol%: " + userStats.renderRateStdDeviationPerc.toFixed(0) + " <br/> " +
          " Nack Rate: " + userStats.nackRate + " <br/> " +
          " Duration: " + userStats.totalDuration + " </span> ";
      }
    }
  }

  getMapSize(x) {
    return Object.keys(x).length;
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

          if (this.matchPriorityOrderToAudio==="true") {
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
          } else {
            this.videoPublishersByPriority.push(uid_string);
          }

          

          this.videoSubscriptionsCount = this.getMapSize(this.videoSubscriptions);
          this.videoPublishersCount = this.getMapSize(this.videoPublishers);
          AgoraRTCUtils.setRemoteVideoPublisherCount(this.videoPublishersCount);
        }
        else if (mediaType === this.AUDIO) {
          this.audioPublishers[uid_string] = currentClient;
          delete this.audioSubscriptions[uid_string];
          this.audioSubscriptionsCount = this.getMapSize(this.audioSubscriptions);
          // check not  already in the priority array
          this.removeUidFromArray(this.audioPublishersByPriority, uid_string);
          // default order will be chronological but this will be rearranged using the VAD
          this.audioPublishersByPriority.push(uid_string);
        }
      });

      // unpublished is called when users mute. Best not to remove them from UI completely
      this.clients[i].on("user-unpublished", async (user, mediaType) => {
        var uid_string = user.uid.toString();
        if (mediaType === this.VIDEO) {
          delete this.videoPublishers[uid_string];
          delete this.videoSubscriptions[uid_string];
          this.removeUidFromArray(this.videoPublishersByPriority, uid_string);
          this.videoSubscriptionsCount = this.getMapSize(this.videoSubscriptions);
          this.videoPublishersCount = this.getMapSize(this.videoPublishers);
          AgoraRTCUtils.setRemoteVideoPublisherCount(this.videoPublishersCount);
        }
        else if (mediaType === this.AUDIO) {
          delete this.audioPublishers[uid_string];
          delete this.audioSubscriptions[uid_string];
          this.audioSubscriptionsCount = this.getMapSize(this.audioSubscriptions);
          this.removeUidFromArray(this.audioPublishersByPriority, uid_string);
        }
      });

      this.clients[i].on("user-left",
        async (user) => {
          delete this.videoPublishers[user.uid.toString()];
          delete this.videoSubscriptions[user.uid.toString()];
          delete this.audioPublishers[user.uid.toString()];
          delete this.audioSubscriptions[user.uid.toString()];
          delete this.userMap[user.uid.toString()];
          delete this.userRemoteStatsMap[user.uid.toString()];
          this.removeUidFromArray(this.usersConnected, user.uid.toString());
          this.removeUidFromArray(this.audioPublishersByPriority, user.uid.toString());
          this.removeUidFromArray(this.videoPublishersByPriority, user.uid.toString());
          this.videoSubscriptionsCount = this.getMapSize(this.videoSubscriptions);
          this.videoPublishersCount = this.getMapSize(this.videoPublishers);
          this.audioSubscriptionsCount = this.getMapSize(this.audioSubscriptions);
          AgoraRTCUtils.setRemoteVideoPublisherCount(this.videoPublishersCount);
        });

      this.clients[i].on("user-joined",
        async (user) => {
          var uid_string = user.uid.toString();
          this.usersConnected.push(uid_string);
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

  doSwitchRxVideoStreamTypeAt2() {
    if (this.videoSubscriptionsCoun >= this.switchVideoStreamTypeAt && this.defaultVideoStreamType == this.HighVideoStreamType) {
      this.defaultVideoStreamType = this.LowVideoStreamType;
    } else if (this.videoSubscriptionsCoun < this.switchVideoStreamTypeAt && this.defaultVideoStreamType != this.HighVideoStreamType) {
      this.defaultVideoStreamType = this.HighVideoStreamType;
    }
  }

  changeAllVideoStreamTypes(streamType, force, batch) {
    var that = this;
    var count = 0;
    for (var v = this.orderedVideoSubs.length - 1; v >= 0; v--) {
      var key = this.orderedVideoSubs[v];
      var user = that.userMap[key];
      var client = that.videoPublishers[key];

      if (that.videoSubscriptions[key] && (that.videoSubscriptions[key].streamType != streamType || force) && (that.mainVideoId !== key || streamType == that.HighVideoStreamType || that.videoSubscriptionsCount<=1) && (batch == 0 || batch > count)) {
        client.setRemoteVideoStreamType(user.uid, streamType);
        that.videoSubscriptions[key].streamType = streamType;
        count++;
      }
    }
    return count;
  }

  changeVideoStreamType(uid_string, streamType) {
    var user = this.userMap[uid_string];
    var client = this.videoPublishers[uid_string];
    if (this.videoSubscriptions[uid_string].streamType != streamType) {
      client.setRemoteVideoStreamType(user.uid, streamType);
      this.videoSubscriptions[uid_string].streamType = streamType;
      return true;
    }
    return false;
  }

  manageSubscriptions() {

    // old method 
    if (this.enableCallStatsToAdjustNumberOfSubscriptions === "true") {
      this.useCallStatsToAdjustNumberOfSubscriptions();
    }

    // new method 
    if (this.enableRemoteCallStatsMonitor === "true") {
      this.manageRampUpAndDown();
    }

    // if share content - show low streams

    if (this.mobileShowHighQualityAtStart === "true" || !isMobile()) {
      // this will blindly switch low/high based on the number of remote videos
      // we need to switch low / high based on the number of remotes and the current status
      // if status is bad it will switch low/high within the limit 
      // it will do so on a priority basis
      // no need for this as high streams will change based on num users in channel
      // mobile should still do it as screen small
      //this.doSwitchRxVideoStreamTypeAt();
    }
    //this.changeLowStreamResolutionIfNeeded(); // not reliable or cross browser

    this.manageGrid();
  }

  manageRampUpAndDown() {

    // State Machine
    /*
      The outgoing (encoding) resolution will be controlled by number of remote publishers in AgoraRTCUtils startAutoAdjustResolution
      * this can be an issue if high stream is reduced too much as active speaker / random selection requires a user to send high stream
      * the compromise is be to limit high resolution reduction and use the low stream (where supported) when more than 16 users

    If content is being shared in the room (watchparty or screenshare) then this is set in AgoraRTCUtils and startAutoAdjustResolution 
    high stream outgoing res. This is best because some browsers and devices don't support dual stream
    

    The basic operation is to show as many remote videos as possible starting from 4 on mobile and 16 on desk/laptop
    If quality of cpu/network is BAD then reduce the quality and then number of streams

      - showing low stream
        this is only useful where < 16 publishers otherwise it will already be equivelent to low stream
        it does not need to be all (say 10) remotes at once but in groups (size based on extremity POOR/CRTIICAL)

        --- can I convert some to low stream?
        --- start with lowest priority, are they publishing? are they low? there could be 64


      - reducing number of remotes
        all remotes are either low stream (because of dual or number of users publishing into the multi channels)
        number to decrease should depend on extremity POOR/CRTIICAL

    If quality of cpu/network is GOOD then increase load

      - increase number of remotes
        if there are hidden remotes show those first (at low stream) before increasing quality

      - increase number 
        if quality is not high then start increasing quality


    */
    if (!this.clientStats) {
      return;
    }

    if (this.clientStats.RemoteStatus != this.remoteStatusCache) {
      // new status
      // start the clock and cache
      this.remoteStatusCache = this.clientStats.RemoteStatus;
      if (!isNaN(this.clientStats.RemoteStatusDuration)) {
        this.remoteStatusDurationCache = this.clientStats.RemoteStatusDuration;
      }
      return; // no need to do anything until there is a consistent trend 
    }

    var currentStatusDuration = this.clientStats.RemoteStatusDuration - this.remoteStatusDurationCache;
    if (currentStatusDuration >= 0 && currentStatusDuration < 3) {
      return; // wait for 3 seconds in new state before acting 
    }
    // resets duration cache
    this.remoteStatusDurationCache = this.clientStats.RemoteStatusDuration;

    var elapse= Math.ceil(( Date.now()- this.clientStats.LastUpdated)/1000);
    console.log("manageRampUpAndDown RemoteStatus " + this.clientStats.RemoteStatus + "." + this.clientStats.RemoteStatusExtra + " shareContentOnDisplay " + this.shareContentOnDisplay + " currentStatusDuration=" + currentStatusDuration + "  MinRemoteDuration " + this.clientStats.MinRemoteDuration + " RTCUtilsInitialised " + this.RTCUtilsInitialised+" elapse="+elapse)

    if (this.clientStats.RemoteStatus == AgoraRTCUtils.RemoteStatusPoor) {
      // batch size 
      this.bwLastDecreaseTime = Date.now();
      var batch = Math.ceil(this.clientStats.RemoteSubCount / 5); // 20% drop 
      if (this.clientStats.RemoteStatusExtra == AgoraRTCUtils.RemoteStatusCritical) {
        batch = Math.ceil(this.clientStats.RemoteSubCount / 3); // larger 33% if critical
      }

      // if we have increased recently then decrease slowly
      if (this.bwLastDecreaseTime - this.bwLastIncreaseTime < 15000 && this.bwLastIncreaseCount > 0) { // within 15 seconds since climb
        batch = this.bwLastIncreaseCount;
        this.bwLastIncreaseCount = 0;
      }

      var count = this.changeAllVideoStreamTypes(this.LowVideoStreamType, false, batch);
      var reduceVideoSubsBy = 0;

      // reduce VIDEO allowed subs
      if (count == 0) {
        if (batch>this.allowedVideoSubsDecreaseBy) {
          batch=this.allowedVideoSubsDecreaseBy;
        }

        if (this.allowedVideoSubs - batch >= this.minVideoAllowedSubs) {
          this.allowedVideoSubs = this.allowedVideoSubs - batch;
          reduceVideoSubsBy = batch;
        } else if (this.allowedVideoSubs > this.minVideoAllowedSubs) {
          reduceVideoSubsBy = this.allowedVideoSubs - this.minVideoAllowedSubs;
          this.allowedVideoSubs = this.minVideoAllowedSubs;
        }


        // reduce AUDIO allowed subs
        if (this.allowedAudioSubs > this.minAudioAllowedSubs) {
          this.allowedAudioSubs--;
        }
        this.bwLastDecreaseCount = reduceVideoSubsBy;
      } else {
        this.bwLastDecreaseCount = count;
      }
      console.log("Move Down: batch=" + batch + " moveLow=" + count + " reduceSubs=" + reduceVideoSubsBy + "  videoSubCount=" + this.videoSubscriptionsCount + " RemoteSubCount=" + this.clientStats.RemoteSubCount);
    } else if (this.clientStats.RemoteStatus == AgoraRTCUtils.RemoteStatusGood && this.RTCUtilsInitialised && this.clientStats.MinRemoteDuration > 3)// && !this.shareContentOnDisplay)
    {

      // RTCUtilsInitialised is checked to ensure we don't ramp up until the camera is enabled.
      // show more remote subs before going high quality
      this.bwLastIncreaseTime = Date.now();
      var slowRamp = false;
      var noRamp = false;
      var count = 0;

      if (this.bwLastIncreaseTime - this.bwLastDecreaseTime < 6000) { // any problems in last 6 seconds
        noRamp = true;
      }
      else if (this.bwLastIncreaseTime - this.bwLastDecreaseTime < 20000) { // if any problems in last 20 seconds?
        slowRamp = true;
      }

      // first video add subs if some missing
      if (!noRamp && !slowRamp && this.allowedVideoSubs <= (this.getMaxVideoTiles() - this.allowedVideoSubsIncreaseBy) && this.allowedVideoSubs <= (this.videoPublishersCount - this.allowedVideoSubsIncreaseBy) && this.allowedVideoSubs < (this.videoSubscriptionsCount + this.allowedVideoSubsIncreaseBy)) {
        this.allowedVideoSubs = this.allowedVideoSubs + this.allowedVideoSubsIncreaseBy;
        count = this.allowedVideoSubsIncreaseBy;
      } else if (!noRamp && this.allowedVideoSubs <= (this.getMaxVideoTiles() - 1) && this.allowedVideoSubs <= (this.videoPublishersCount - 1) && this.allowedVideoSubs < (this.videoSubscriptionsCount + 1)) {
        this.allowedVideoSubs = this.allowedVideoSubs + 1;
        count++;
      }
      // increase AUDIO allow subs
      if (!noRamp && this.allowedAudioSubs < this.maxAudioSubscriptions && this.allowedAudioSubs < (this.audioSubscriptionsCount + 1)) {
        count++;
        this.allowedAudioSubs = this.audioSubscriptionsCount + 1;
      }

      // increase video quality
      if (!noRamp && count == 0 && !(this.shareContentOnDisplay && this.clientStats.RemoteSubCount > 7)) {
        var batch = Math.ceil(this.clientStats.RemoteSubCount / 4); // 25% increase
        if (slowRamp) { // flip flop
          batch = 1;
        }
        var count = this.changeAllVideoStreamTypes(this.HighVideoStreamType, false, batch);

        console.log("Move Up: batch=" + batch + " moveHigh=" + count + " increaseSubs=0 videoSubCount=" + this.videoSubscriptionsCount + " RemoteSubCount=" + this.clientStats.RemoteSubCount);

      } else {
        console.log("Move Up: batch=0 moveHigh=0 increaseSubs=" + count + " videoSubCount=" + this.videoSubscriptionsCount + " RemoteSubCount=" + this.clientStats.RemoteSubCount);
      }


      this.bwLastIncreaseCount = count;

      // if status is good and we have someone in main window at low res and not sent message to him for a while 
      // send a request to increase every 3s
      // he will stay higher res for 6s
      if (this.mainVideoId) { // send every 3 seconds    
        if (this.videoSubscriptions[this.mainVideoId] && this.videoSubscriptions[this.mainVideoId].streamType == this.LowVideoStreamType) {
          // move to high
          this.changeVideoStreamType(this.mainVideoId, this.HighVideoStreamType);
        }
        else {
          // if height> > 360 then send him a PM
          if (this.userRemoteStatsMap[this.mainVideoId] && (parseInt(this.userRemoteStatsMap[this.mainVideoId].receiveResolutionHeight, 10) < 360 || this.bwLastIncreaseResolutionRequestEnabled)) {
            if (Date.now() - this.bwLastIncreaseResolutionRequest > 3000) {
              this.bwLastIncreaseResolutionRequestEnabled = true;
              this.bwLastIncreaseResolutionRequest = Date.now();
              this.peerMessage(this.INCREASE_RESOLUTION, this.mainVideoId);
              console.warn("requesting INCREASE_RESOLUTION");
            }
          }
        }
        this.bwLastMainWindowIdIncreaseTime = this.bwLastIncreaseTime;
      }
    }


    // reduce encoding resolutions in share mode
    if (this.shareContentOnDisplay) {
      AgoraRTCUtils.setTempMaxProfile("180p");
      if (this.clientStats.RemoteSubCount > 7)  // max tiles below content area
      {
        // subscribe to low stream
        this.changeAllVideoStreamTypes(this.LowVideoStreamType, false, 0);
      }
    }
    else if (this.clientStats.RemoteSubCount > 16) // max 180p for keeping under 720p
    {
      // if more than 16 then drop to low stream (160x90) to keep below 720p
      // but dont subscribe to low of main window id
      this.changeAllVideoStreamTypes(this.LowVideoStreamType, false, 0);
    }


  }



  async manageGrid() {
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
    var expectedVideoSlotCount = 0;
    for (var v = 0; v < numVideoSlots; v++) {
      // any slots not present add
      this.addVideoSlotIfNotExisting(this.videoPublishersByPriority[v]);
      // remove any slots present which should not be  
      expectedVideoSlots[this.videoPublishersByPriority[v]] = this.videoPublishersByPriority[v];
      expectedVideoSlotCount++;
    }

    // have grid cells if room for non publishers
    if (this.getMaxVideoTiles() > this.videoPublishersByPriority.length && this.usersConnected.length > this.videoPublishersByPriority.length) {
      var that = this;
      for (var v = 0; v < this.usersConnected.length; v++) {
        var key = this.usersConnected[v];
        if (!expectedVideoSlots[key] && expectedVideoSlotCount < that.getMaxVideoTiles()) {
          that.addVideoSlotIfNotExisting(key);
          // remove any slots present which should not be  
          expectedVideoSlots[key] = key;
          expectedVideoSlotCount++;
        }
      }
    }


    this.removeSlotsIfNotInMap(expectedVideoSlots);

    // video subs
    var expectedVideoSubs = {};
    var lorderedVideoSubs = []; //  build  subs ordered list (array) for reducing quality as needed
    for (var v = 0; v < numVideoSubs; v++) {
      // add any subs not present 
      this.addVideoSubIfNotExisting(this.videoPublishersByPriority[v]);
      // remove any slots present which should not be  
      expectedVideoSubs[this.videoPublishersByPriority[v]] = this.videoPublishersByPriority[v];
      lorderedVideoSubs.push(this.videoPublishersByPriority[v]);
    }

    this.orderedVideoSubs = lorderedVideoSubs;

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
    if (!this.gridLayout && this.usersConnected.length == 0 && !this.shareContentOnDisplay) {
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
        that.audioSubscriptionsCount = that.getMapSize(that.audioSubscriptions);
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
    this.audioSubscriptionsCount = this.getMapSize(this.audioSubscriptions);
    var that = this;
    if (this.performSubscriptions === "true") {
      await client.subscribe(user, this.AUDIO).then(response => {
        user.audioTrack.play();
      }).catch(e => {
        delete that.audioSubscriptions[uid_string];
        that.audioSubscriptionsCount = that.getMapSize(that.audioSubscriptions);
        console.error(e);
      });
    }
  }

  async removeVideoSubsIfNotInMap(expected) {
    var that = this;
    Object.keys(this.videoSubscriptions).forEach(async function (key) {
      if (!expected[key]) {
        var then = that.videoSubscriptions[key].startTime;
        if ((Date.now() - then) > that.minRemoteStreamLife) {
          console.log(" removeVideoSubsIfNotInMap " + key + " allowedVideoSubs " + that.allowedVideoSubs + " age " + (Date.now() - then));
          var user = that.userMap[key];
          var client = that.videoPublishers[key];
          var prom = await client.unsubscribe(user, that.VIDEO);
          delete that.videoSubscriptions[key];
          that.videoSubscriptionsCount = that.getMapSize(that.videoSubscriptions);
          // remove user stats
          var stats_display = document.getElementById(key + "_stats_display");
          if (stats_display) {
            stats_display.innerHTML = "" ;
          }
        }
      }
    });
  }

  addVideoSubIfNotExisting(uid_string) {
    if (this.videoSubscriptions[uid_string]) {
      return;
    }
    var user = this.userMap[uid_string];
    if (!user) {
      console.error("No USER " + uid_string);
    }
    var client = this.videoPublishers[uid_string];

    this.videoSubscriptions[uid_string] = {
      startTime: -1,
      streamType: this.defaultVideoStreamType,
    };

    this.videoSubscriptionsCount = this.getMapSize(this.videoSubscriptions);
    this.doSwitchRxVideoStreamTypeAt2();

    // now client; 
    var that = this;
    if (this.performSubscriptions === "true") {
      client.subscribe(user, this.VIDEO).then(response => {

        user.videoTrack.play(uid_string);
        that.removeAgoraInnerVideoStyling();
        // allow stream to fallback to audio only when congested
        // 1 is for low quality
        //client.setStreamFallbackOption(user.uid, 1); // Automatically subscribe to the low-quality video stream under poor network.
        client.setStreamFallbackOption(user.uid, 0); //disable fall back
        client.setRemoteVideoStreamType(user.uid, that.videoSubscriptions[uid_string].streamType);
        that.videoSubscriptions[uid_string].startTime = Date.now();
        // handleScreenshareSub
        that.handleScreenshareSub(uid_string);

      }).catch(e => {
        delete that.videoSubscriptions[uid_string];
        that.videoSubscriptionsCount = that.getMapSize(that.videoSubscriptions);

        console.error(e);
      });
    }
  }

  removeAgoraInnerVideoStyling() {
    var els = document.getElementsByClassName("remote_video");
    var that = this;
    Array.prototype.forEach.call(els, function (el) {
      var children = el.childNodes;
      children.forEach(function (item) {
        if (!item.className.match(/\bremove_agora_video_style\b/)) {
          item.classList.add("remove_agora_video_style");
        }

      });
    });

    // remove tile if in follow speaker area
    els = document.getElementsByClassName("focussed-video-inner");
    Array.prototype.forEach.call(els, function (el) {
      var children = el.childNodes;
      children.forEach(function (item) {
        if (!item.className.match(/\bremove_agora_video_style\b/)) {
          item.classList.add("remove_agora_video_style");
        }

      });
    });

    // remove tile if in follow speaker area
    els = document.getElementsByClassName("local_video");
    Array.prototype.forEach.call(els, function (el) {
      var children = el.childNodes;
      children.forEach(function (item) {
        if (!item.className.match(/\bremove_agora_video_style\b/)) {
          item.classList.add("remove_agora_video_style");
        }

      });
    });

    // remove tile if in follow speaker area
    els = document.getElementsByClassName("player");
    Array.prototype.forEach.call(els, function (el) {
      var children = el.childNodes;
      children.forEach(function (item) {
        if (!item.className.match(/\bremove_agora_video_style\b/)) {
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
        that.mainVideoId = null;
        that.bwLastIncreaseResolutionRequestEnabled = false;
        that.disableShareContent();
      }
    });
  }

  addVideoSlotIfNotExisting(uid_string) {
    if (!document.getElementById(uid_string)) {
      const playerDomDiv = document.createElement("div");
      playerDomDiv.id = uid_string;
      var setClass = "remote_video";
      if (isMobile())
        setClass = "remote_video remote_video_mobile";

      playerDomDiv.className = setClass;

      // click to expand and subscribe to high quality
      var that = this;
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
          
          that.changeVideoStreamType(uid_string,that.HighVideoStreamType);
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
          that.changeVideoStreamType(uid_string,that.defaultVideoStreamType);
        
        }
        */
      };

      const stats_display = document.createElement("div");
      stats_display.className = "stats_display";
      stats_display.id = uid_string + "_stats_display";
      playerDomDiv.append(stats_display);

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
      if (this.videoPublishersByPriority.length > 0 || this.shareContentOnDisplay || this.usersConnected.length > 0) {
        this.gridLayout = false;
        document.getElementById("focus-video").classList.remove("hidden");
        document.getElementById("grid").classList.add("grid_wrapper_follow");
        if (loadActiveSpeaker) {
          if (this.videoPublishersByPriority.length > 0) {
            this.moveToLargeWindow(this.videoPublishersByPriority[0]);
          } else {
            this.moveToLargeWindow(this.usersConnected[0]);
          }
        }
      }
    } else if (!this.shareContentOnDisplay) { // follow speaker
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
    // don't set until above called to take person out of this vie
    this.setShareContentDisplay(true);
    this.showContentView();
  }

  disableShareContent() {
    // if local user is hosting watch party
    // it will exit locally for him
    // others will keep receiving the queue message
    // 
    if (this.hostingWatchParty)
      return;
    this.setShareContentDisplay(false);
    this.showGridView();
  }

  setShareContentDisplay(enable) {
    this.shareContentOnDisplay = enable;
    if (enable) {
      AgoraRTCUtils.setTempMaxProfile("180p");
    } else {
      AgoraRTCUtils.setTempMaxProfile(null);
    }
  }

  handleScreenshareSub(uid_string) {
    var uidi = parseInt(uid_string, 10);
    if (uidi < this.maxScreenshareUID) {
      this.currScreenshareUID = uidi;
      if (!this.shareContentOnDisplay) {
        this.showContentView();
        if (this.mainVideoId !== uid_string) {
          this.moveToLargeWindow(uid_string);
        }
        this.setShareContentDisplay(true);
      } else {
        this.stopScreensharePublish(); // will stop current one if local
        if (this.mainVideoId !== uid_string) {
          this.moveToLargeWindow(uid_string);
        }
        this.setShareContentDisplay(true);
      }
    }
  }

  returnLargeToGrid() {
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
      if (moveel && this.usersConnected.indexOf(uid_string) > -1) { // this.videoPublishers[uid_string]) {
        if (this.mainVideoId) {
          var prevMain = document.getElementById(this.mainVideoId);
          if (prevMain) { // put back in grid
            var gridel = document.getElementById("grid");
            if (!this.shareContentOnDisplay && this.enableContentSpeakerMode === "true") {
              prevMain.classList.add("remote_video");
              prevMain.classList.remove("focussed-video-inner");
              gridel.insertBefore(prevMain, moveel);
            }
            if (this.videoPublishers[this.mainVideoId]) {
              // It will get set back to low if needed by the main state controller: manageRampUpAndDown()
              //  this.changeVideoStreamType(this.mainVideoId,this.defaultVideoStreamType);
            }
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
        if (this.videoPublishers[this.mainVideoId]) {
          this.changeVideoStreamType(uid_string, this.HighVideoStreamType);
        }
      }
    } else {
      if (this.mainVideoId && this.usersConnected.indexOf(this.mainVideoId) > -1) { //  this.videoPublishers[this.mainVideoId]
        var prevMain = document.getElementById(this.mainVideoId);
        if (prevMain) { // put back in grid
          var gridel = document.getElementById("grid");
          if (!this.shareContentOnDisplay && this.enableContentSpeakerMode === "true") {
            gridel.insertBefore(prevMain, document.getElementsByClassName('remote_video')[0]);
            prevMain.classList.add("remote_video");
            prevMain.classList.remove("focussed-video-inner");
          }
        }
        if (this.videoPublishers[this.mainVideoId]) {
          // It will get set back to low if needed by the main state controller: manageRampUpAndDown()
          // this.changeVideoStreamType(this.mainVideoId,this.defaultVideoStreamType);
        }
        this.mainVideoId = null;
      }
    }
    this.bwLastIncreaseResolutionRequestEnabled = false;
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

    this.rtmClient.on('MessageFromPeer', ({ text }, senderId) => {
      this.handleRTM(senderId, text);
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
    } else if (text.startsWith(this.INCREASE_RESOLUTION)) {
      AgoraRTCUtils.increaseResolution();
      console.log(text);
    }

  }

  // Publishing Local Streams
  async joinChannels() {
    let tempChannelName = "";
    let i = 0;
    // Join one channel for each client object.
    for (i; i < this.numClients; i++) {
      tempChannelName = this.baseChannelName + i.toString();
      await this.clients[i].setClientRole("audience");
      this.myUid[i] = await this.clients[i].join(this.appId, tempChannelName,
        this.token, null);
    }


    this.numChannels = i;
  }

  async loadDevices() {
    // create local tracks

    var vwidth=this.highVideoWidth;
    var vheight=this.highVideoHeight;
    var vfps=this.highVideoFPS;
    var vbrmin =this.highVideoBitrateMin;
    var vbrmax= this.highVideoBitrateMax;

    if ( this.videoPublishersCount>4) {
      var vwidth=360;
      var vheight=180;
      var vfps=24;
      var vbrmin=150;
      var vbrmax=500;
      this.initialProfile="180p";
    }

    [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
      {}, { encoderConfig: { width: vwidth, height: vheight, frameRate: vfps, bitrateMin: vbrmin, bitrateMax: vbrmax } });
  }

  async startCamMic(cameraId, micId) {

    this.getFirstOpenChannel();
    this.cameraId = cameraId;
    this.micId = micId;
    await this.publishAudioVideoToChannel();
    if (this.muteMicOnJoin === "true") {
      toggleMic();
    }
  }


  async stopScreensharePublishLocal() {
    if (this.screenClient) {
      if (this.screenTracks && this.screenTracks.videoTrack) {
        this.screenTracks.videoTrack.close(); // close on screen
      }
      await this.screenClient.leave();
      this.screenClient = null;
    }
  }


  async peerMessage(msg, peerId) {
    this.rtmClient.sendMessageToPeer({ text: msg }, peerId).then(() => {
    }).catch(error => {
      console.error('AgoraRTM send peer message failure');
    });
  }

  async stopScreensharePublish() {
    if (this.screenClient) {
      this.stopScreensharePublishLocal();
    } else {
      var msg = this.STOP_SCREENSHARE;
      this.rtmChannel.sendMessage({ text: msg }).then(() => {
      }).catch(error => {
        console.error('AgoraRTM send failure for stopScreensharePublish');
      });
    }
  }

  async publishScreenShareToChannel() {
    this.screenClient = AgoraRTC.createClient(this.clientConfig);
    var availableClient = this.getFirstOpenChannelInner();
    let tempChannelName = this.baseChannelName + availableClient.toString();
    var ssuid = this.currScreenshareUID + 1;
    if (ssuid >= this.maxScreenshareUID) {
      ssuid = this.minScreenshareUID;
    }
    await this.screenClient.setClientRole("host");
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

      var that = this;
      this.screenTracks.videoTrack._originMediaStreamTrack.onended = function () {
        that.stopScreensharePublishLocal(); that.showGridView(); agoraWatchParty.togglePlayerControls();
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

      var vwidth=this.highVideoWidth;
      var vheight=this.highVideoHeight;
      var vfps=this.highVideoFPS;
      var vbrmin =this.highVideoBitrateMin;
      var vbrmax= this.highVideoBitrateMax;
  
      if ( this.videoPublishersCount>4) {
        var vwidth=360;
        var vheight=180;
        var vfps=24;
        var vbrmin=150;
        var vbrmax=500;
        this.initialProfile="180p";
      }
  
      if (this.cameraId && this.micId) {
        [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
          { microphoneId: this.micId }, { cameraId: this.cameraId, encoderConfig: { width: vwidth, height: vheight, frameRate: vfps, bitrateMin: vbrmin, bitrateMax: vbrmax } });
      } else {
        [this.localTracks.audioTrack, this.localTracks.videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks(
          {}, {  encoderConfig: { width: vwidth, height: vheight, frameRate: vfps, bitrateMin: vbrmin, bitrateMax: vbrmax } });
      }
    }

    if ((this.enableDualStream === "true" && !isMobile()) || this.enableDualStreamMobile === "true") {
      this.clients[this.myPublishClient].enableDualStream().then(() => {
        console.log("Enable Dual stream success!");
      }).catch(err => {
        console.error(err);
      })
      this.clients[this.myPublishClient].setLowStreamParameter({ bitrate: this.lowVideoBitrate, framerate: this.lowVideoFPS, height: this.lowVideoHeightCurrent, width: this.lowVideoWidthCurrent });
    }

    this.localTracks.videoTrack.play("local-player");
    document.getElementById("local-player").classList.remove("hidden");
    await this.clients[this.myPublishClient].setClientRole("host");
    await this.clients[this.myPublishClient].publish([this.localTracks.audioTrack, this.localTracks.videoTrack]);

    document.getElementById("mic_on").classList.add("hidden");
    document.getElementById("mic_off").classList.remove("hidden");
    document.getElementById("cam_on").classList.add("hidden");
    document.getElementById("cam_off").classList.remove("hidden");

    if (!this.RTCUtilsInitialised) {
      this.initRTCUtils( this.initialProfile);

      // we will use the last channel name and UID to join RTM for send/receive VAD messages
      this.rtmChannelName = this.baseChannelName;
      this.rtmUid = this.myUid[this.myPublishClient].toString();
      this.initRTM();
    }
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
        agoraApp.vadUid = "local-player";
        document.getElementById(agoraApp.vadUid).classList.add("remote_video_active");

      }).catch(error => {
        console.error('AgoraRTM VAD send failure');
      });
    }
  }


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
        console.error(err);
      })
      this.clients[this.myPublishClient].setLowStreamParameter({ bitrate: this.lowVideoBitrate, framerate: this.lowVideoFPS, height: this.lowVideoHeightCurrent, width: this.lowVideoWidthCurrent });
    }

    this.localTracks.videoTrack.play("local-player");
    await this.clients[this.myPublishClient].setClientRole("host");
    await this.clients[this.myPublishClient].publish(this.localTracks.videoTrack);

    /*
    if (this.enableHDAdjust === "true" || (AgoraRTCUtils.isIOS() &&  this.enableHDAdjustiOS === "true")) {
      AgoraRTCUtils.startAutoAdjustResolution(this.clients[this.myPublishClient], "360p_11", AgoraRTCUtils.isIOS());
      AgoraRTCUtilEvents.on("LocalVideoStatistics",agoraApp.processLocalVideoStatistics);

    }
    */

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
    await this.clients[this.myPublishClient].setClientRole("host");
    await this.clients[publishToIndex].publish(this.localTracks.audioTrack);
    /*
    AgoraRTCUtils.startVoiceActivityDetection(this.localTracks.audioTrack);
    */
    console.log("### PUBLISHED AUDIO TO " + publishToIndex + "! ###");
  }

  // Returns the index of the first client object with an open channel.
  async getFirstOpenChannel() {

    if (this.myPublishClient > -1) {
      return this.myPublishClient;
    }

    this.myPublishClient = this.getFirstOpenChannelInner();
    await this.clients[this.myPublishClient].setClientRole("host");
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

    var connected_users = this.usersConnected.length;
    if (connected_users == 1 && this.gridLayout && !this.shareContentOnDisplay) {
      this.shownPersonToPerson = true;
      this.toggleLayout(true);
    } else if (connected_users != 1 && this.shownPersonToPerson && !this.gridLayout && !this.shareContentOnDisplay) {
      this.shownPersonToPerson = false;
      this.toggleLayout();
    }


    var cell_width = this.CellWidthBase; // 160 and smallest possible size 
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

    // desktop grid is square but mobile is rectangular
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
        if (cellCount < 16) { // portrait and fewer than 16
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
          if (cellCount > 6) {
            rows = 2;
          }
        } else {  // landscape
          rows = 1;
        }
      } else {
        rows = 1;
        if (cellCount > 6) {
          rows = 2;
        }
      }

      cols = Math.ceil(cellCount / rows);
      if (connected_users == 1 && !this.shareContentOnDisplay) {  // handle two people - me and one other
        var focus_height = height - toolbar_height - grid_padding * 3;
        var focus_width = width - (grid_padding * 2);
        document.getElementById("focus-video").style.height = focus_height + 'px';
        document.getElementById("focus-video").style.width = focus_width + 'px';
        toolbar_height_and_focus_height = toolbar_height + focus_height;
        rows = 1;
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

    // mobile grid gaps
    if (isMobile()) {
      var mel = document.getElementById("main_body");
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

    var grid_available_height = height - toolbar_height_and_focus_height - (grid_padding * (rows + 2));
    var grid_available_width = width - (grid_padding * cols);

    if (connected_users == 1 && !this.gridLayout && !this.shareContentOnDisplay) { // 1 other person to display larger
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

    var grid_width = (cell_width * cols) + ((cols) * cell_margin) + 3;
    var grid_height = (cell_height * rows) + ((rows) * cell_margin) + 3;
    if (grid_width > width) {
      grid_width = width;
    }

    document.getElementById("grid").style.width = grid_width + 'px';
    document.getElementById("grid").style.height = grid_height + 'px';

    var grid_actual_width = document.getElementById("grid").offsetWidth;
    var grid_actual_height = document.getElementById("grid").offsetHeight;

    document.getElementById("grid").style.marginTop = '0px';
    var ml = ((width - grid_actual_width) / 2);// - (   + 1) ;
    if (ml < 0) {
      ml = 0;

    }
    document.getElementById("grid").style.marginLeft = ml + 'px';
    document.getElementById("media_controls").style.marginTop = '0px';

    document.getElementById("local-player").style.width = cell_width + 'px';
    document.getElementById("local-player").style.height = cell_height + 'px';

    // add orange box around speaker 
    if (this.vadUid && document.getElementById(this.vadUid) && this.gridLayout) {
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

    if (agoraApp.vadUid == "local-player") {
      document.getElementById(agoraApp.vadUid).classList.remove("remote_video_active");
      agoraApp.vadUid = null;
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

  await agoraApp.init();
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
  // allow time to find users in each channel
  // this is a hack and a production multi channel 
  setTimeout(async function () { await agoraApp.startCamMic() }, 4000);
}

window.addEventListener('resize', resizeGrid);

var showDeviceSelection = getParameterByName("showDeviceSelection") || "true";

if (showDeviceSelection === "true") {
  showMediaDeviceTest();
} else {
  connect();
}

var autoShowStats = getParameterByName("autoShowStats") || "false";
if (autoShowStats === "true") {
  toggleStats();
}

