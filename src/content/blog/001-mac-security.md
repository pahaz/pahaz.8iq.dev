---
author: Pahaz White
pubDatetime: 2024-03-02T10:02:21.243Z
modDatetime: 2024-05-05T10:04:22.153Z
title: Who touched my Mac? Catching the cleaning staff or evil maid detection
slug: macbook-evil-maid-detection
featured: true
draft: false
tags:
  - security
  - macbook
description:
  "I often go on business trips and travel, and I always worry about the security of my MacBook
  when it's left alone in the room 😀. During my last trip, I had an unpleasant surprise:
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

![evil maid detection](@assets/images/001-intro.png)

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
