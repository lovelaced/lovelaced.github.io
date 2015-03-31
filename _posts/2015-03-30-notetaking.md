first, and robots
======

In order to properly keep a blog, without such tedious entries such as, for example, “first post”
or “sorry I haven’t updated” or “I’ve been busy” or other useless, contentless reads that take up 
everyone’s time and who knows how much hosting space, I’m not going to post anything here unless there’s 
actual content.

So here we go.

I have recently endeavored to undertake a project of my own, as a result of my resignation in CS-dom,
rather than the (far superior) field of computer engineering due to whatever circumstances I won’t go into
here. The nature of this project, I decided, would preferably be as close to the metal as possible without 
actually approaching the eldritch horrors of electricity on the level which only electrical engineers can 
gaze upon without losing their sanities entirely.

I was lucky enough to be pointed toward Shira, a very engaging woman who created MOARBots, https://sites.google.com/site/moarbots/, an initiative 
for low-budget, easily-accessible robotics. She very nicely supplied me with a care package of some fun bits 
of hardware and sent me on my way. Along with the help of Google I’ve begun to decipher what she’s given me, 
and so we arrive at the real meat of this post.

Hardware list:
==============
* ESP8266 wifi module, costs something like $3-$5
* Arduino Leonardo
* Breadboard adapter for the ESP8266 from embedded-labs.com
* Step up/step down voltage regulator (https://www.pololu.com/product/2122)
* Voltage-level translator breakout (https://www.sparkfun.com/products/11771)
* A couple LEDs, breadboard, and wire to stitch all of it together.

![Arduino Leonardo and ESP8266](/assets/itsalive.jpg)

I wired everything up and it took quite awhile to get just right. Originally, the red and blue lights on the 
ESP8266 module both stayed on constantly no matter what I did (the red light should be on, but the blue light
should only flicker on boot and any TX/RX activity.)

Finally, after plenty of trial and error, I found a wiring configuration which worked for me; various sources all 
over the internet suggested different pins pulled up/down/around/tied to caps/pulled up with resistors, but I found 
no need for any extra hardware beyond what I’ve already listed. My wiring diagram is as follows:

|-- Arduino --   |-- 3.3-5V Translator -- |-- Regulator --  |-- ESP8266 --    |
|:----------:|:-----------------:|:----------:|:-----------:|
| TX         | OE->OE            |            | RX          |
| RX         |                   |            | TX          |
| 8          | B1->A1            |            | RST         |
| 9          | B2->A2            |            | CHPD        |
| 10         | B3->B3            |            | GPIO0       |
| 5V         | VccB->VccA        | VIN->Vout       | VCC, CHPD   |
| 3.3V       | VccA              | “ “        | “ ”         |
| GND        | GND (both)        | GND        | GND         |

* __note:__ only connect GPIO0 if you’re using a sketch that allows you to put the ESP8266 into programming mode.
* __note 2:__ the TX of the ESP8266 can be directly connnected to the Arduino’s RX as it is still read as a high and 
that saves us a spot on the translator for something else.
* __note 3:__ connect LEDs to whatever you want; I’ll be using two, one connected to 13 and one connected to 12 and of course grounded.
The sketch I’ve used most successfully simply does a few checks and then connects to the internet using a user-provided SSID/password:

{% highlight C %}
/*

Arduino Leonardo <--> ESP8266

*/

#define SSID "SSID"
#define PASS "password"
#define DST_IP "whatever you want to retrieve"
#define CONNECT_ATTEMPTS 20
#define RST 8
#define CHP 9
//#define GPIO0 10
#define RED_LED 12
#define OR_LED 13

void setup() {
  //digitalWrite(GPIO0, HIGH);
  pinMode(RST, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(OR_LED, OUTPUT);
  pinMode(CHP, OUTPUT);

  reset();

  Serial.begin(115200);
  Serial1.begin(9600);

  delay(5000);
  
  while (!Serial && !Serial1) {
     Serial.println("waiting..."); // wait for serial port to connect. Needed for Leonardo only
  } 
  
  Serial1.println("AT+RST");
  delay(1000);
  Serial.println(getResponse("AT", 10));
  delay(1000);
  digitalWrite(OR_LED, HIGH);
  Serial.println(getResponse("AT+RST", 10));
  delay(1000);
//  Serial.println(getResponse("AT+CWMODE = 1", 10));
//  delay(1000);
//Uncomment this line to list APs
//  Serial.println(GetResponse("AT+CWLAP", 10));
//  delay(1000);
  digitalWrite(OR_LED, LOW);
  Serial1.println("AT+RST");
  delay(10);
  if (Serial1.find("ready")) Serial.println("Module is ready!");
  else {
    digitalWrite(RED_LED, HIGH);
    Serial.println("ESP8266 Module did not respond.");
    Serial.println("Enter Commands Manually.");
    while (1) chk_serial_io();
  }
  digitalWrite(RED_LED, LOW);
  delay(1000);
  boolean connected = false;
  for (int i = 0; i < CONNECT_ATTEMPTS; i++) {
    digitalWrite(OR_LED, HIGH);
    delay(10);
    if (connectWiFi()) {
      connected = true;
      break;
    }
  }
  if (!connected) {
    digitalWrite(RED_LED, HIGH);
    Serial.println("Couldn't connect.");
    Serial.println("Enter Commands Manually.");
    while (1) chk_serial_io();
  }
  digitalWrite(RED_LED, LOW);
  delay(5000);
  Serial.println("IP address:");
  Serial.println(getResponse("AT+CIFSR", 10));
  delay(1000);
  Serial.println("");
  Serial.println(getResponse("AT+CIPSTATUS", 10));
  delay(1000);
  Serial.println(getResponse("AT+CIPMUX=0", 10));
  delay(1000);
  // if you want to send commands manually after the wifi connects,
  // uncomment this line
  // while(1) chk_serial_io();
}

void reset() {
  digitalWrite(RED_LED,HIGH);
  digitalWrite(OR_LED,HIGH);
  digitalWrite(CHP,HIGH);
  digitalWrite(RST,LOW);
  delay(100);
  digitalWrite(RST,HIGH);
  delay(1000);
  digitalWrite(RED_LED,LOW);
  digitalWrite(OR_LED,LOW);
}

void loop() {
  String cmd = "AT+CIPSTART=\"TCP\",\"";
  cmd += DST_IP;
  cmd += "\",55555";
  Serial1.println(cmd);
  Serial.println(cmd);
  if (Serial1.find("Error")) return;
  cmd = "GET / HTTP/1.0\r\n\r\n";
  Serial1.print("AT+CIPSEND=");
  Serial1.println(cmd.length());
  if (Serial1.find(">")) {
    Serial.print(">");

  } else {
    digitalWrite(RED_LED, HIGH);
    Serial1.println("AT+CIPCLOSE");
    Serial.println("connection timeout");
    delay(1000);
    digitalWrite(RED_LED, LOW);
    return;
  }
  Serial1.print(cmd);
  delay(2000);
  while (Serial1.available()) {
    char c = Serial1.read();
    Serial.write(c);
    if (c == '\r') Serial.print('\n');
  }
  Serial.println("====");
  delay(1000);
}

void chk_serial_io() {
  if (Serial1.available()) {
//    if (Serial1.find("busy")) {
//      Serial.println("Resetting...");
//      reset();
//    }
    int inByte = Serial1.read();
    Serial.write(inByte);
  }
  if (Serial.available()) {
    int inByte = Serial.read();
    Serial1.write(inByte);
  }
}

boolean connectWiFi() {
  Serial1.println("AT+CWMODE=1");
  String cmd = "AT+CWJAP=\"";
  cmd += SSID;
  cmd += "\",\"";
  cmd += PASS;
  cmd += "\"";
  Serial.println(cmd);
  Serial1.println(cmd);
  delay(2000);
  if (Serial1.find("OK")) {
    digitalWrite(OR_LED, HIGH);
    Serial.println("OK, wifi connected.");
    delay(10);
    digitalWrite(OR_LED, LOW);
    return true;
  } else {
    digitalWrite(RED_LED, HIGH);
    Serial.println("Cannot connect to wifi.");
    delay(10);
    return false;
  }
}

String getResponse(String AT_Command, int wait){
  String tmpData;
  
  Serial1.println(AT_Command);
  delay(10);
  while (Serial1.available() >0 )  {
    char c = Serial1.read();
    tmpData += c;
    
    if ( tmpData.indexOf(AT_Command) > -1 )         
      tmpData = "";
    else
      tmpData.trim();       
          
   }
   return tmpData;
}

{% endhighlight %}




A couple more notes:
====================
* If you flash the ESP8266 and the blue light just stays on, reset the Arduino without disconnecting it from power.
It seems to be fine after reset.
* CHPD __must__ be pulled high. This is the only configuration I’ve found that works.
* I’ve left GPIO0 floating for this sketch. 

What’s next?
============

I’ve been taking a look at how to get into the firmware since the ultimate goal is to run the ESP8266
 without an Arduino telling it what to do. This is very doable, and I’ve found a few very helpful posts on 
 the ESP8266 forums and have built a toolchain along with the Espressif SDK. 

I found this Hackaday post EXTREMELY useful: http://hackaday.com/2015/03/18/how-to-directly-program-an-inexpensive-esp8266-wifi-module/

I hope to have gotten my hands even more deeply into this module in a few days.
