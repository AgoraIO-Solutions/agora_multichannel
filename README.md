This demo project uses multiple Agora channels to increase the number of remote video streams displayed on screeen beyond the limits of a single channel.

This demo is configured to use 4 channels (maxClients=4) allowing for up to 16*4=64 remote videos.

Rather than immediately subscribing to publishing users when a "user-published" event is received, the users are put into a list (videoPublishersByPriority / audioPublishersByPriority).

A function (monitorStatistics) runs every 150ms which monitors the renderingRate of each of the remote video streams. The renderingRate is an Agora statistic which is incredibly sensitive to fluctations in available network and processing power. Based on the renderingRate of each video stream the number of audio and video subscriptions is increased, held or decreased.

The maximum number of audio subscriptions is configured to 6 while the maximum number of video subscriptions (maxVideoTiles) is set at 9 for mobile and 49 for desktop.

When somebody starts talking they broadcast a VAD message over RTM to let others in group know that they are talking. This ensures that their audio is subscribed to if it is not currently (in the situation where more than 6 have their mic unmuted) and that their video is brought on screen if not already.

Monitoring remote render rates works very well unless the sender is not reaching the requested encoding FPS. To address this problem, encoding users share their outbound FPS via RTM when it is falling below 90% of the requested FPS.

Depenending on your network, it can take a reasonabling long amount of time to ramp up to a high number of remote video streams. Improvemets to the algo could be made to allow it to ramp up more quickly.

Usage:

clone this repo into a folder being served by a webserver e.g. nginx 
Access the demo using an Agora appid (which doesn't have tokens enabled)
e.g. https://sokool.io/agora_multichannel/?appid=AAAAAAAA

A more advanced example which sets the name, number and host count:
https://sa-utils.agora.io/demo/?appid=AAAAAAAA&channelNamePrefix=multi&maxChannels=16&maxHostsPerChannel=1

appid - Your AppId.  
channelNamePrefix - The common prefix that each of the multiple channels will have at the start of their name.  
maxChannels - The maximum number of channels.      
maxHostsPerChannel - The maximum number of hosts in each channel.   

