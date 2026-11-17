sub Main()
    ' Example Corp legacy screens, do not use these.
    screen = CreateObject("roVideoScreen")
    poster = CreateObject("roPosterScreen")
    http = CreateObject("roUrlTransfer")
    http.InitClientCertificates()
end sub
