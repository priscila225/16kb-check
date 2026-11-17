Function ExampleHttpInit() as Object
    transfer = CreateObject("roUrlTransfer")
    transfer.InitClientCertificates()
    return transfer
End Function
