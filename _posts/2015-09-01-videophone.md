T-Vone Part 1
==============
 

*400mhz ARM processor?*

*128MB RAM?*

*USB port, SD card slot?*

*640x480 LCD?*

__*For less than $4?*__


Yes, okay, I'll take it.

What this device is is an ACN Iris 3000: a deprecated SIP video phone produced by a shady company with less than great service.
Naturally, I don't intend to use it as advertised. It runs Linux 2.6.22.6 with some GPL-violating closed-source modules on an armv5 (ARM926EJ-S) processor and has support for external storage, so naturally, it's begging to be put to a purpose which isn't calling people from one's cubicle.

One can connect to its WLAN port with an ethernet cable and assign it an IP (or use iptables to forward your internet connection to it, 
in which case I believe it will give itself an IP) and then telnet in with username/password root/root.

So, long story short, busybox sucks if you actually want to do anything fun. This system has a lot of functionality but it doesn't have a package manager or any way to compile things, 
so I wanted a full distribution. Debian seemed to fit the bill. Therefore, I went about creating a Debian ARM (armel) image with qemu.
Note: Try to use a kernel as close to the kernel on your phone as possible. I tried using Debian Wheezy and chroot would not function, therefore I had to use Debian Squeeze.

Create a 10gb qemu image:

 `$ qemu-img create -f qcow hda.img 10G `

Get all the stuff you need to boot Linux on that image:

 `$ wget http://ftp.de.debian.org/debian/dists/oldoldstable/main/installer-armel/current/images/versatile/netboot/initrd.gz`

 `$ wget https://people.debian.org/~aurel32/qemu/armel/vmlinuz-2.6.32-5-versatile`

 `$ wget https://people.debian.org/~aurel32/qemu/armel/initrd.img-2.6.32-5-versatile`

And then boot the image itself:

 `$ qemu-system-arm -M versatilepb -kernel vmlinuz-2.6.32-5-versatile -initrd initrd.gz -hda hda.img -append "root=/dev/ram" `




Wait for the system to boot, then follow through with the installation process; most mirrors will fail, but I found Uzbekistan still has proper Debian Squeeze repos so that should work.
if networking doesn't just work, try:


 `$ sudo qemu-system-arm -M versatilepb -kernel vmlinuz-2.6.32-5-versatile -initrd initrd.gz -hda hda.img -append "root=/dev/ram" -net nic -net tap,ifname=tap0,script=no,downscript=no`

 
Then after the system boots, add tap0 and ethernet to a bridge:

 `$ sudo brctl addif br0 eth0`

 `$ sudo brctl addif br0 tap0`

 
I also have NAT / internet sharing set up via iptables as explained in the Arch Wiki "Internet Sharing" article.
You can check if you're actually transferring data with the nload utility (or whatever else you want to use).

You can boot into your new installation with the following command:

 `$ qemu-system-arm -M versatilepb -kernel vmlinuz-2.6.32-5-versatile -initrd initrd.img-2.6.32-5-versatile -hda hda.img -append "root=/dev/sda1"`

You can install/compile packages and whatever else you want to do now, or if you'd rather do it natively on the phone, you can just shut down qemu.
After you're sure Debian is properly installed, you're going to want to format your media (I used a USB stick) as a blank ext3 partition. I used gparted for this in the sake of laziness.

Then you'll want to convert your qemu image to a raw one:

 `$ qemu-img convert hda.img -O raw hda.img.raw`


Then you should be able to view/verify its partitions with fdisk -l. For some reason, dd seems to fail, so I mounted the paritions to /dev/mapper with kpartx like so:

 `$ sudo kpartx -av hda.img.raw`

 `$ sudo mount /dev/mapper/loop0p1 /mnt/tmp`

 (of course, your exact loop device will vary, just look at the partitions to see which you should mount.)

 Then we can finally transfer everything over to the USB stick:

 `$ sudo rsync -av /mnt/tmp /mnt/usb`

 
Once you insert this into the phone, it will automount (in the case of a USB stick) to /mnt/usb. I believe the SD card will automount to /mnt/sd, but I haven't verified this.

In order to use your newly set up Debian system, you'll need to do the following (on the phone), where you're likely logged in as root:


 `# cd /mnt/usb`

 `# mkdir oldroot`

 `# pivot_root . oldroot/`

 `# chroot . /bin/bash`

Be sure to bind your system mountpoints accordingly: http://superuser.com/questions/165116/mount-dev-proc-sys-in-a-chroot-environment

And then, after all that, this should get you into a bash shell where you can have all the fun you'd like. Personally, I installed a tiling window manager, though I have yet to test it with a keyboard.

![ACN Iris 3000, rice edition](/assets/vone1.jpg)

Once I play around with it more and see what I can get running on it, I'll post an update.
