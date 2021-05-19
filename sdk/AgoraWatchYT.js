
class AgoraWatchYT {

    constructor() {
        this.player;
        this.playerInit = false;
        this.watchPartyOwner = false;
        this.watchPartyOwnerPlaying = false;
        this.tag = document.createElement('script');
        this.tag.src = "https://www.youtube.com/iframe_api";
        this.firstScriptTag = document.getElementsByTagName('script')[0];
        this.firstScriptTag.parentNode.insertBefore(this.tag, this.firstScriptTag);
    }


    // 4. The API will call this function when the video player is ready.
    onPlayerReady(event) {
        
    }

    // 5. The API calls this function when the player's state changes.
    //    The function indicates that when playing a video (state=1),
    //    the player should play for six seconds and then stop.
    onPlayerStateChange(event) {
    }

    togglePlayerControls() {
        if (document.getElementById("player_container").classList.contains("hidden")) {
            document.getElementById("player_container").classList.remove("hidden");
            document.getElementById("toolbar").classList.add("headerOpen");
        } else {
            document.getElementById("player_container").classList.add("hidden")
            document.getElementById("toolbar").classList.remove("headerOpen");
        }
    }

    enableShareContent() {
        if (!this.playerInit) {
            this.initWatchPlayer();
            this.playerInit = true;
        }
        agoraApp.shareContentOnDisplay = true;
        if (agoraApp.mainVideoId) {
            agoraApp.moveToLargeWindow();
        }
        document.getElementById("ytplayer").classList.remove("hidden");
        if (agoraApp.gridLayout) {
            agoraApp.toggleLayout(true);
        }
    }

    disableShareContent() {
        agoraApp.shareContentOnDisplay = false;
        document.getElementById("ytplayer").classList.add("hidden");
    }

    initWatchPlayer() {
        setInterval(() => {
            this.broadcastSeek();
        }, 2000);
    }

    cueVideo() {
        this.enableShareContent();
        var msg = agoraApp.WATCHYT + ':CUE:' + document.getElementById("ytid").value;
        this.sendWatchMessage(msg);
        this.player.cueVideoById({ 'videoId': document.getElementById("ytid").value });
        agoraApp.watchPartyOwnerPlaying = false;

    }

    playVideo() {
        this.enableShareContent();
        var msg = agoraApp.WATCHYT + ':PLAY:' + document.getElementById("ytid").value;
        this.sendWatchMessage(msg);
        this.player.playVideo();
        this.player.setVolume(80);
        agoraApp.watchPartyOwnerPlaying = true;
    }

    broadcastSeek() {
        if (agoraApp.watchPartyOwner && agoraApp.watchPartyOwnerPlaying) {
            var msg = agoraApp.WATCHYT + ':SEEK:' + document.getElementById("ytid").value + ":" + this.player.getCurrentTime();
            this.sendWatchMessage(msg);
        }
    }

    stopVideo() {
        var msg = agoraApp.WATCHYT + ':STOP:' + document.getElementById("ytid").value;
        this.sendWatchMessage(msg);
        agoraApp.watchPartyOwnerPlaying = false;
        this.player.stopVideo();
        this.disableShareContent()
    }

    sendWatchMessage(msg) {
        agoraApp.watchPartyOwner = true;
        agoraApp.rtmChannel.sendMessage({ text: msg }).then(() => {
            //console.log('AgoraRTM FPS send success :' + msg);
        }).catch(error => {
            console.log('AgoraRTM WATCHYT send failure');
        });
    }

    handleRTM(text){
        //console.log(text);
        this.watchPartyOwner = false; // someone else in control
        this.watchPartyOwnerPlaying = false;
        var command = text.split(":")[1];
        var vid = text.split(":")[2];
        this.enableShareContent();
        if (command === "CUE") {
          if (document.getElementById("ytid").value !== vid) {
            document.getElementById("ytid").value = vid;
          }
          this.player.cueVideoById({ 'videoId': vid });
        }
        else if (command === "PLAY") {
          if (document.getElementById("ytid").value !== vid) {
            document.getElementById("ytid").value = vid;
            this.player.loadVideoById({ 'videoId': vid });
          }
          this.player.playVideo();
          this.player.setVolume(80);
        }
        else if (command === "STOP") {
            this.player.stopVideo();
        }
        else if (command === "SEEK") {
          var to = text.split(":")[3];
          var rounded = Math.round(to * 10) / 10
          this.watchPartyOwner = false;
          if (document.getElementById("ytid").value !== vid) {
            document.getElementById("ytid").value = vid;
            this.player.loadVideoById({ 'videoId': vid, 'startSeconds': rounded });
            this.player.setVolume(80);
          } else {
            if (Math.abs(this.player.getCurrentTime() - rounded) > 2) {
                this.player.seekTo(to);
            }
          }
        }
    }
}

let agoraWatchYT = new AgoraWatchYT();

function onYouTubeIframeAPIReady() {
    agoraWatchYT.player = new YT.Player('ytplayer', {
        height: '100%',
        width: '100%',
        videoId: 'ytplayervid',
        playerVars: { 'autoplay': 0, 'controls': 0 },
        events: {
            'onReady': agoraWatchYT.onPlayerReady,
            'onStateChange': agoraWatchYT.onPlayerStateChange
        }
    });
}

function pushToTalkStart() {
    agoraWatchYT.player.setVolume(10);
    agoraApp.localTracks.audioTrack.setEnabled(true);
    document.getElementById("mic_on").classList.add("mic_push");
  }
  
  function pushToTalkStop() {
    agoraApp.localTracks.audioTrack.setEnabled(false);
    document.getElementById("mic_on").classList.remove("mic_push");
    agoraWatchYT.player.setVolume(80);
  }
