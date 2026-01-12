---
author: Pahaz White
pubDatetime: 2024-03-02T10:02:21.243Z
modDatetime: 2026-01-11T10:09:48.123Z
title: Who touched my Mac? Evil maid detection
slug: macbook-evil-maid-detection
featured: false
draft: false
tags:
  - security
  - macbook
  - evil maid
description:
  "I often go on business trips and travel, and I always worry about the security of my MacBook
  when it's left alone in the room. During my last trip, I had an unpleasant surprise:
  I noticed that someone had touched my closed laptop while I was away. In this article,
  we'll look at how to detect attempts of physical access to your MacBook,
  gather data about the intrusion, and send it to yourself via Telegram."
---

I often go on business trips and travel, and I always worry about the security of my MacBook
when it's left alone in the room 😀. During my last trip, I had an unpleasant surprise:
I noticed that someone had touched my closed laptop while I was away.

In this article,
we'll look at how to detect attempts of physical access to your MacBook,
gather data about the intrusion, and send it to yourself via Telegram.

![evil maid detection](@/assets/images/001-intro.png)

## Evil maid in two words

The ["evil maid"](https://en.wikipedia.org/wiki/Evil_maid_attack) attack is a scenario where an attacker gains physical access to someone's computer without the owner's knowledge.
This can happen, for example, in a hotel room or at a workplace. The attacker can use this access to install malicious software
or hardware tracking devices, which can intercept passwords, copy files, install backdoors, or carry out other types of interference
with the device's operation. The attack itself can be so covert that the user may not even suspect it has occurred until they
face the consequences.

It's worth mentioning that there are attack methods that are extremely difficult to defend against.
An example of such a vector is the implementation of a hardware implant. Or the use of ["modified"
accessories, such as a charger with an embedded "backdoor"](https://mg.lol/blog/defcon-2019/).

You can open the laptop case to gain direct access to any peripheral device or insert a hardware implant.
In the article, we will set this aside and look at attacks that do not require opening the case.
I recommend planning in advance **how you will detect if your laptop has been tampered** with in order
to try to protect against such evil maid attacks.

My MacBook is equipped with four Thunderbolt 3 (USB-C) ports, which defines the primary vector we're
considering for an Evil Maid attack via the connection of an **external USB device**. Typically, this
**imitation device** pretends to be a keyboard, touchpad, monitor, or something USB-compatible. Once connected,
the imitator, using software or hardware vulnerabilities, achieves the ability to execute its own code.
You can check out a [collection by Andrey Konovalov, where he demonstrates examples of attacks using various USB devices](https://github.com/xairy/usb-hacking).

The scariest part is making changes to the firmware of peripheral devices; this is hard to detect.
In MacBooks, there are many such devices whose firmware and drivers can be altered: **Thunderbolt** and **USB** controllers, **Wi-Fi** and **Bluetooth** modules,
**SSD/HDD** disks, as well as **BIOS/UEFI**.
[Example 1](https://thehackernews.com/2015/06/mac-osx-rootkit-malware.html),
[example 2](https://thehackernews.com/2015/01/thunderstrike-infecting-apple-macbooks.html),
[video](https://www.youtube.com/watch?v=n_3eIFMR46Y),
[Rubber Ducky](https://hak5.org/products/usb-rubber-ducky).

## What can be done?

1. It's clear that to counter attacks, you need to regularly update the OS.

2. Additionally, I would recommend enabling [Lockdown mode](https://support.apple.com/en-us/105120) to block USB devices when the Mac is locked.

3. And a standard method of protection is setting a [firmware password](https://support.apple.com/en-us/102384) and enabling the [Startup Full Security option](https://support.apple.com/en-us/102522) to prevent booting from external disks, which could lead to modifications in the firmware or bootloader.

4. Consider how you can detect tampering with your laptop. An opened case provides a large surface for attacks with direct access to all peripherals.

## DoNotDisturb monitoring

Beyond basic protection methods, let's delve deeper into monitoring intrusion attempts and gathering more data at the moment of attack.
For this, we will use the open-source utility [DoNotDisturb](https://objective-see.org/products/dnd.html) (or DND),
developed by Patrick Wardle (aka @patrickwardle).

The working mechanism is simple: when the laptop is opened, we receive a notification. Unfortunately, DND ignores power on/off events and the connection of new USB devices, activating only when the **laptop is opened**. At this moment, DND can:

- execute a command;
- send a notification to a specific app (not available in the Russian region);
- start monitoring USB devices and running processes.

We will send ourselves a message on Telegram with logs of connected USB devices.

## DoNotDisturb Setup for Telegram

Overall, it's simple: download [DoNotDisturb](https://objective-see.org/products/dnd.html), install it. We won't use the special app, but instead, we'll run our script when the laptop is opened.

![DND1](@/assets/images/001-dnd-1.png)

In DND, there's an option to perform certain actions through a special app; since we are not using it, we set the option to No Remote Tasking.
You can also disable automatic updates (the last release was 6 years ago).

![DND2](@/assets/images/001-dnd-2.png)

Enable the Monitoring option to collect logs of running processes and connected USB devices.
Enter the bash command that will be executed when the laptop lid is opened.

And a script for sending messages to Telegram. For this, you need to register a new bot using [BotFather](https://t.me/BotFather);
I won't go into details on that. Additionally, we will send logs collected by DND about running processes and connected USB devices.
Copy the script to a folder of your choice, and don't forget to make it executable (`chmod +x`).

```bash file="alarm.sh"
#!/bin/bash

set -e

# !!! You need to change this to your own Telegram token
API_TOKEN="589612151:AAFbC0GM0ATFehCgife13tr3vER3eBbEzaX"
# !!! You need to change this to your own Telegram chat identifier
CHAT_ID="-1042193212045"

# How to quickly find the CHAT_ID?
# Add the bot to a chat, send it a message there,
# then execute the command `curl $API_URL/getUpdates`,
# the chat identifier will be in the response text.

API_URL="https://api.telegram.org/bot$API_TOKEN"
ABS_LOG_PATH="/Library/Objective-See/DND/DND.log"
LOG_FILE="/tmp/.capture.output.txt"
MESSAGE="ALARM: $@"

echo "$(date)" > $LOG_FILE

# Immediately notify upon lid opening!
curl -s -X POST "$API_URL/sendMessage" -d "chat_id=$CHAT_ID" -d "text=$MESSAGE" >> $LOG_FILE 2>&1

# Wait 1 second before sending logs
sleep 1

# Send logs collected by DND, can resend after some time
curl -F "chat_id=$CHAT_ID" -F "document=@$ABS_LOG_PATH" "$API_URL/sendDocument"
```

## Bonus: Detecting Tampering

There's a [good article that describes methods for protecting against tampering](https://dys2p.com/en/2021-12-tamper-evident-protection.html).
One of the recommended methods is the use of a [glitter nail polish](https://shop.proxysto.re/conf/501) protects that is difficult to restore.

![glitter nail](@/assets/images/001-glitter.jpeg)

In the image above, there's an example where access was gained by replicating a fairly complex pattern using glitter nail.

It seems that the safest method currently is to use vacuum packaging with multicolored grains and check for tampering using a [special app](https://github.com/proninyaroslav/blink-comparison).

![packaging with multicolored grains](@/assets/images/001-rice.jpeg)

However, these are methods for the truly paranoid, as it's hard to imagine packing your laptop in a vacuum-sealed bag with rice every time you leave a hotel room. It might be simpler just to carry the laptop with you 🧑‍💻.
