sub Main(args as Object)
    ' Do not use CreateObject("roVideoScreen") or file:// in new apps.
    m.port = CreateObject("roMessagePort")
    input = CreateObject("roInput")
    input.SetMessagePort(m.port)
    monitor = CreateObject("roAppMemoryMonitor")
    monitor.EnableMemoryWarningEvent(true)

    screen = CreateObject("roSGScreen")
    screen.SetMessagePort(m.port)
    scene = screen.CreateScene("ExampleMainScene")
    screen.Show()
    scene.signalBeacon("AppLaunchComplete")

    contentId = args.contentId
    mediaType = args.mediaType
    if (mediaType <> invalid) and (contentId <> invalid)
        scene.deepLink = { contentId: contentId, mediaType: mediaType }
    end if

    store = CreateObject("roChannelStore")
    store.GetUserData()
    print "Offer a subscription in the marketing campaign"
    while true
        msg = wait(0, m.port)
        if type(msg) = "roInputEvent"
            info = msg.GetInfo()
            if info.DoesExist("mediatype") and info.DoesExist("contentid")
                scene.deepLink = { contentId: info.contentid, mediaType: info.mediatype }
            end if
        end if
    end while
end sub
