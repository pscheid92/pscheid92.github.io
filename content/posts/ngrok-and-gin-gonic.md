---
title: Using ngrok-go with gin-gonic
desciption: an article showing how to combine gin-gonic and ngrok-go to expose your local http server via ngrok to the public internet.
---

 In this brief tutorial, we're going to discuss how to utilize the newly released [ngrok-go](https://ngrok.com/blog-post/ngrok-go) library alongside `gin-gonic`. The `ngrok-go` library provides a way to expose local servers to the internet, which can be highly beneficial during development and testing phases. On the other hand, `gin-gonic` is a highly-regarded web framework for building APIs in Go, recognized for its minimalistic design and excellent performance. When combined, these tools can significantly enhance the efficiency of your web application development process.

 ```go
// define an endpoint /now that returns the current time.
r := gin.Default()
r.GET("/now", func(c *gin.Context) {
	response := gin.H{"time": time.Now()}
    c.JSON(http.StatusOK, response)
})

// We instruct ngrok to listen to our application.
// The 'config.HttpEndpoint' allows us how ngrok exposes our application.
// The result of `ngrok.Listen(...)` implements the net.Listener interface.
ctx := context.Background()
listener, err := ngrok.Listen(ctx, config.HTTPEndpoint())
if err != nil {
    log.Fatalln(err)
}
    
// We log the ngrok address, which serves as the address to access your local server from the internet.
log.Printf("public address: %s\n", listener.Addr())

// We start the gin application with the ngrok listener.
// This fires up the gin server and makes it accessible through the ngrok address.
if err := r.RunListener(listener); err != nil {
    log.Fatalln(err)
}
``` 

 After booting up the server locally, follow these steps to access it via the ngrok address:

1. Copy the address output by `listener.Addr()`. This is the ngrok address that you can use to access your local server from the internet.
2. Run your local server using the command `go run .`. This initiates your gin server.
3. You can now access your server by sending a request to the ngrok address. In the example below, we use the 'https' command to send a GET request to the '/now' endpoint of our server. 

 ```shell
$ GIN_MODE=release go run .
2023/05/20 17:56:19 public address: fee6-2003-dc-d740-7394-7c9a-a007-80fa-b617.eu.ngrok.io
[GIN] 2023/05/20 - 17:56:33 | 200 | 29.583µs | 2001:dc:e741:7394:7c9a:a018:80fa:b617 | GET "/now"
```

When you send a request to your server, you should receive a JSON response similar to this
```shell
$ https fee6-2003-dc-d740-7394-7c9a-a007-80fa-b617.eu.ngrok.io/now

HTTP/1.1 200 OK
Content-Length: 43
Content-Type: application/json; charset=utf-8
Date: Sat, 20 May 2023 15:56:33 GMT
Ngrok-Agent-Ips: 2003:dc:d740:7394:7c9a:a007:80fa:b617
Ngrok-Trace-Id: f8919710b6a082c85e69836ee251a02a

{
    "time": "2023-05-20T17:56:33.807461+02:00"
}
``` 
