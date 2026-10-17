---
author: Pahaz White
pubDatetime: 2026-10-17T07:06:17Z
title: A Model Cascade for Russian Speech Transcription
slug: model-cascade-russian-speech-transcription
image: "@/assets/images/003-russian-speech-transcription/01-cover.png"
featured: false
draft: false
tags:
  - speech-recognition
  - transcription
  - whisper
  - gigaam
  - parakeet
  - macos
description: "How I compared 32 speech recognition configurations and combined GigaAM with Parakeet to transcribe Russian meetings locally, reducing WER from 27.0% to 21.7%."
canonicalURL: https://pahaz.8iq.dev/posts/model-cascade-russian-speech-transcription/
timezone: Europe/Istanbul
---

![A village meeting where speech recognition turns the Russian phrase for "we have no budget" into "NASA.NET has a budget"](@/assets/images/003-russian-speech-transcription/01-cover.png)

I spend a substantial part of my working day in meetings and discussions. When my child was born and the sleepless nights began, I started missing details. What deadline did they mention? Who promised to get back with an answer? What did we finally agree on?

That's how the story of [Recorder](https://pahaz.8iq.dev/recorder/) began. At first, I was going to buy an existing app. Then I started comparing Whisper, Parakeet, and GigaAM. In the end, I tested 32 recognition configurations and put together a cascade of two models: one provides the base text, the other corrects inaccuracies. On my datasets, this fixed one in five errors ([WER](https://en.wikipedia.org/wiki/Word_error_rate) dropped from 27.0% to 21.7%).

Those experiments turned into a free Mac app that records meetings and converts audio and video to text locally. I'll explain how I chose the models, what I measured, and which obvious solutions didn't work. The article includes [a prompt for an agent](https://gist.github.com/pahaz/db2faf33bd0e1ca45b815b0f705a9b41) so you can build it yourself.

## Why I was only looking for local transcription

The standard solution: type "meeting transcription" into a search engine and pick a service. There is no shortage of options. The problem is figuring out how they differ.

I immediately limited my search to local apps. My meetings cover budgets, personnel decisions, contract terms, and internal company problems. Not every C-level meeting can be sent to an external service.

I know many people give these recordings to Claude or ChatGPT. But I'm not comfortable sending either the conversations themselves or the participants' voices there. So the requirement was simple: the audio and transcript must stay on my laptop.

It seems that all these apps work the same way: take an open model, add an interface, and offer a subscription. There are a few extra features: audio recording, speaker separation, handling long files. I'll get to those later.

The list of familiar models inside different apps does repeat itself. [MacWhisper](https://macwhisper.com/), [Buzz](https://github.com/chidiwilliams/buzz), and [SuperWhisper](https://superwhisper.com/) use Whisper. [Handy](https://github.com/cjpais/Handy) supports both Whisper and Parakeet.

Actually, I was just going to buy SuperWhisper Pro. I remember a price of around $85 a year, but the payment didn't go through. Perhaps if the purchase had worked, I would have left it at that. Instead, I had to figure things out.

I started with Whisper. It's the baseline. It produced readable text, but made noticeable mistakes in my Russian meetings and ran slowly. For some tasks, that quality is enough. I wanted better.

## What Deep Research Gave Me

After doing Deep Research with Claude, Gemini, and ChatGPT, my main candidates were Whisper large-v2, large-v3, and turbo, Parakeet TDT v3, and GigaAM-v3. Later, to make the experiment more thorough, I added Breeze-ASR, Qwen3-ASR, and other models.

Connecting a model turned out to be the easiest part. Even local agents can build a prototype that takes a file and returns text. But a working prototype doesn't answer the main question: which model should you choose, and why?

I had to answer that myself, and it took substantially more time than the code.

## At first, I chose a model by eye

I ran recordings of my meetings through the models and read the transcripts. I had to vibe-code a diff tool to make comparing the texts easier. My first impressions were:

- **GigaAM** hears ordinary Russian speech well. I like its punctuation. But it started having trouble with terms, product names, and IT slang. The text looked coherent, yet it wasn't always possible to understand the point of the conversation.
- **Parakeet** was substantially better at hearing terms and English slang. The resulting text looked worse: the model is multilingual and isn't tailored to Russian the way GigaAM is. But it was almost always possible to reconstruct the meaning from its text.

Both models ran quickly.

- **Whisper** seemed very attentive to certain details. Sometimes it preserved things that Parakeet and GigaAM missed. But it ran more slowly, and in some places it added phrases that weren't in the recording. Its quality varied widely. The results didn't look consistent, but sometimes they were impressive.

These were impressions from reviewing my transcripts, an archive of 36 hours of meetings.

At that point, I chose Parakeet. For my recordings, it looked like a reasonable compromise between speed, accuracy, and preserving terms.

That worked for me for a while. Then I wanted to improve the quality, and it became clear: without measurements, I would just keep choosing whichever text I liked more. I needed metrics!

## How I collected data to compare ASR models

![A man reviewing a meeting transcript with a red pencil, surrounded by Git folders and a note saying "I didn't say that"](@/assets/images/003-russian-speech-transcription/02-datasets.png)

Annotation turned out to be the most time-consuming part. Running a model is easy. Checking exactly what it omitted, replaced, or made up takes much longer.

I put together four datasets.

| Dataset           | What's recorded                                                                                                               | Duration         | Words / terms |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------- |
| Business meetings | I selected 82 excerpts from work meetings where the models disagreed the most. Then added the same number of random excerpts. | About 24 minutes | 1,870 / ~5%   |
| IT speech         | A specially prepared text packed with IT terms                                                                                | About 24 minutes | 1,679 / ~41%  |
| Cat feeder        | A story about a smart cat feeder, read by two voices. Something between the first two datasets.                               | About 24 minutes | 2,391 / ~14%  |
| Synthetic         | 200 phrases containing technical terms, voiced by Silero TTS. To see how well this method reflects reality.                   | About 26 minutes | 2,831 / ~14%  |

That gave me **about 1 hour 38 minutes of audio with reference transcripts and 8,700 words**. Separately, I had an archive of 185 recordings totaling 36 hours, which I used to inspect the results after testing hypotheses on the annotated sample. It has no complete reference transcript or full annotation for calculating WER. The archive contains about 230,000 words.

The meetings dataset has an important characteristic: I selected difficult passages. In 40 excerpts, the model wasn't confident in the result; in another 42, the text looked strange to an LLM. Then I added 82 random excerpts for balance.

I tested synthetic speech separately. I wanted to see whether I could generate spoken tests with the terms I needed, and how suitable this method would be for analysis.

### How I measured errors and speed

The main metric, WER, counts substitutions, omissions, and extra words relative to the reference transcript. Lower is better. Before comparing, I converted the text to lowercase, replaced "ё" with "е", and removed punctuation. "Клод" instead of Claude counted as an error. This test didn't evaluate punctuation at all.

Audio was fed in chunks of up to 20 seconds, split at pauses. For Whisper, I used Silero VAD to separate speech from silence. I ran the measurements on an Intel Core i9 without GPU acceleration.

## Whisper, GigaAM, and Parakeet on Russian speech

In the main table, I kept the models that show the differences clearly. The detailed comparison covered 32 configurations in total, including different quantizations, prompts, and ways of running the models.

| Model                    | Meetings, WER | IT speech, WER | Cat feeder, WER | Overall, WER |
| ------------------------ | ------------- | -------------- | --------------- | ------------ |
| GigaAM-v3 e2e            | **14.8%**     | 52.9%          | 16.3%           | 27.0%        |
| Parakeet TDT 0.6B v3     | 24.6%         | 40.0%          | 13.9%           | **24.6%**    |
| Whisper large-v2         | 30.1%         | **39.0%**      | 11.5%           | 24.8%        |
| Whisper large-v3         | 27.1%         | 59.8%          | 11.6%           | 30.3%        |
| Whisper large-v3-turbo   | 28.7%         | 66.5%          | 11.1%           | 32.5%        |
| Whisper medium           | 39.4%         | 43.9%          | 13.5%           | 29.6%        |
| Breeze-ASR-25            | 35.4%         | 43.4%          | **9.6%**        | 26.7%        |
| Qwen3-ASR 1.7B           | 30.1%         | 48.6%          | 14.7%           | 29.0%        |
| NVIDIA Canary 1B v2      | 31.9%         | 47.4%          | 16.4%           | 29.9%        |
| GigaAM Multilingual 600M | 21.1%         | 58.4%          | 22.2%           | 32.9%        |

Here, Whisper ran with Russian explicitly selected and no text prompt; Breeze ran with [a prompt](https://github.com/egsok/klava-nevinovata/blob/96afc0e90053b9c81a1db127c2ca2b05ae9066b9/src/components/settings/TranscriptionPrompt.tsx#L45). Lower WER is better.

The main observation: **every model has its own strengths and weaknesses**.

GigaAM is more accurate on meeting excerpts. Whisper large-v2 and Parakeet lead on IT speech. On average, Parakeet really is better. Breeze has the best score on the read-aloud story, which matches @egorsokolov's tests.

Whisper large-v2 is better than v3 only on speech with terms: it transcribes them more accurately. But v3 is slightly more accurate on meetings. V3 hears a dense stream of English terms in a distorted way. The likely reason is in the training: much of the data for v3 was labeled by v2 itself, and mixed Russian-English speech didn't get any better as a result.

Breeze-ASR-25 is Whisper large-v2 fine-tuned on speech that mixes Chinese and English. It has the best result on "Cat feeder", mostly thanks to the terms. On live meetings, Breeze makes mistakes and performs worse than almost all the other models.

The picture was calmer with compressed models. GigaAM Q8 and F32 produced almost identical results. For Parakeet on meetings, the scores were 24.6% for F32, 25.5% for Q8, and 25.7% for Q6_K. The difference is small, but it's there. I left this out of the table, along with the different prompts, which didn't affect the results much.

The tests also included Russian fine-tunes of Whisper, but all of them performed worse on my datasets than the original models, so I left them out of the table too.

The metrics for synthetic speech differed from those for live speech: Parakeet had a WER of 16.8%, GigaAM 22.8%. There were visible biases, so I excluded it from further consideration and evaluation.

## Why WER alone isn't enough

After the measurements, it became clearer why the table and my impressions of the text sometimes differed.

WER doesn't know which word matters to the conversation. Replacing a system's name and replacing the word "ну" ("well") each count as one error. But for a person, the consequences are different. Without a name or a term, sometimes you can't understand the point of the conversation.

![One omitted word has the same WER cost: dropping "well" leaves the meaning intact, while dropping "not" reverses a decision to sell](@/assets/images/003-russian-speech-transcription/03-word-errors.png)

The opposite happens too. A model writes "эластик" instead of Elastic. In a strict comparison, that's an error. For a reader who knows the product, the meaning may be preserved.

I wanted to separate spelling errors from cases where the model actually distorted a word. So I added my own heuristic and called it **WER by sound (WERx)**.

It works with text; it doesn't listen to audio. Latin characters are converted into a Cyrillic phonetic key, and soft signs, spaces, and hyphens are removed. For example, Cloud-MD and "клауд мд" get the same key. Then it compares the similarity of the keys or their consonants. At the same time, two ordinary Russian words must match exactly: "пропадал" and "пропадает" don't become the same word.

This isn't a universal phonetic metric or a measure of how well meaning is preserved. It answers the question: how many errors come from writing similar sounds differently?

| Model            | IT speech: WER | IT speech: WERx | Exactly transcribed terms |
| ---------------- | -------------- | --------------- | ------------------------- |
| GigaAM           | 52.9% →        | 40.6%           | 19%                       |
| Parakeet         | 40.0% →        | 30.7%           | 47%                       |
| Whisper large-v2 | 39.0% →        | 30.3%           | 54%                       |

GigaAM's score improved noticeably after this normalization. Some of the errors really were about spelling. But the gap behind Parakeet remained almost ten percentage points. So transliteration alone won't fix the problem.

On meetings, the result changed much less: from 14.8% to 14.1% for GigaAM, and from 24.6% to 23.6% for Parakeet. The density of terms isn't as high there.

That gave me two separate requirements. I needed a model that transcribes ordinary Russian conversation well. And I needed a way to preserve the terms (English borrowings / slang) that this model gets wrong.

## A cascade of two models: GigaAM and Parakeet

![GigaAM handles the Russian text and punctuation while Parakeet corrects the misheard product name to Prometheus](@/assets/images/003-russian-speech-transcription/04-model-cascade.png)

I liked GigaAM's Russian text and how Parakeet handled terms (plus it was four times faster). I wanted to combine their results.

I took GigaAM's transcript as the base. Parakeet independently transcribed the same audio. Then I aligned the two texts, found differences, and checked possible replacements.

I took a version from Parakeet if it contained Latin characters and sounded sufficiently similar to the corresponding GigaAM passage. I left the rest of the text unchanged.

For example, this made it possible to replace "апкид" with AppKit, "Sweeft" with Swift, and "Промиус" with Prometheus. But it also introduced errors: "диф" could turn into div, and "клот" into Cloud instead of Claude. Similar sound doesn't necessarily mean the replacement is correct.

The main parameter was the similarity threshold. At a low threshold, the cascade accepted corrections more readily; at a high one, it skipped more candidates.

| Replacement rule                                           | IT speech, WER | Meetings, WER |
| ---------------------------------------------------------- | -------------- | ------------- |
| GigaAM only                                                | 52.9%          | 14.8%         |
| Latin characters, similarity of at least 0.3               | 41.0%          | 14.5%         |
| Latin characters, similarity of at least 0.4               | 41.9%          | 14.5%         |
| Latin characters, similarity of at least 0.5               | 43.4%          | 14.5%         |
| Latin characters, similarity of at least 0.7               | 49.1%          | 14.6%         |
| Similarity of at least 0.5, no Latin-character requirement | 43.6%          | 17.4%         |

Without the Latin-character restriction, the results on meetings got worse. The cascade picked up not only useful terms from Parakeet, but also errors in ordinary Russian words.

For further analysis, I chose the version with a threshold of 0.4. This isn't a universal optimum, but it gives a "safe" replacement. Here is what I got with a threshold of 0.4:

| Variant                          | Meetings, WER | IT speech, WER | Cat feeder, WER | Overall, WER |
| -------------------------------- | ------------- | -------------- | --------------- | ------------ |
| GigaAM                           | 14.8%         | 52.9%          | 16.3%           | 27.0%        |
| Parakeet                         | 24.6%         | 40.0%          | 13.9%           | 24.6%        |
| GigaAM with Parakeet corrections | 14.5%         | 41.9%          | 12.0%           | 21.7%        |

On dense IT text, the cascade lost to Parakeet alone. But compared with GigaAM, it cut WER by 11 percentage points and increased the share of exactly transcribed terms from 19% to 44%.

On meetings, GigaAM's quality was preserved. I wouldn't count the difference between 14.8% and 14.5% as the main achievement on such a small sample. What matters more is that correcting terms didn't worsen the overall score. On "Cat feeder", where an ordinary story was mixed with technical words, the cascade performed better than either model on its own.

The price was a second recognition pass. The cascade had an RTF of about 0.3 on my Intel machine. For recognition itself, that's about 18 minutes per hour of audio.

## Why GigaAM became the base rather than Parakeet

Before the cascade, I had been using Parakeet. So I tested the reverse approach too: keep its text and use GigaAM to correct low-confidence words. That setup didn't beat GigaAM alone.

And there was another factor: most of the conversation is ordinary Russian speech. GigaAM produced the best results on that in my data. It makes sense to trust it with the base and let the second model correct inaccuracies.

This doesn't mean GigaAM should be the base for every recognition task. For a recording with a dense stream of English terms, Parakeet alone performed better than this cascade.

## Which model is best at correcting GigaAM

The next question: why should Parakeet be the one suggesting corrections? Could another model do it better, even if its own transcript is worse?

I compared the candidates in a separate series of experiments. I used the same correction rule for all of them, stricter than the one in the previous section.

| Model suggesting corrections | Meetings, WER | IT speech, WER | Cat feeder, WER | Overall, WER |
| ---------------------------- | ------------- | -------------- | --------------- | ------------ |
| None, GigaAM only            | 14.8%         | 52.9%          | 16.3%           | 27.0%        |
| **Parakeet**                 | 14.8%         | 42.5%          | 12.1%           | 22.0%        |
| Whisper medium               | 14.4%         | 41.9%          | 11.3%           | **21.4%**    |
| Whisper large-v2             | 15.2%         | **41.3%**      | 11.6%           | 21.5%        |
| Breeze-ASR-25 with a prompt  | 16.7%         | 43.4%          | **10.2%**       | 22.0%        |
| Whisper large-v3             | **14.3%**     | 50.1%          | 11.6%           | 24.0%        |
| Qwen3-ASR 1.7B               | 15.2%         | 45.8%          | 11.8%           | 23.0%        |

Whisper medium produced a lower WER than Parakeet on all three datasets. But it ran about three times more slowly. The larger Whisper large-v2 was slightly better at correcting IT text, but made the results on meetings worse than GigaAM alone.

I settled on Parakeet. It didn't win on accuracy, but offered a good balance of quality and speed: Whisper medium's RTF ranged from 0.45 to 0.68, compared with 0.15 to 0.23 for Parakeet. Large-v2 and Breeze were even slower, from 0.8 to 1.7.

It also became clear that a good standalone model and a good source of corrections aren't necessarily the same thing. For example, Whisper medium lagged noticeably behind on meetings in the main table, but proved useful as a correction model.

![Expectation: buy a transcription app and relax. Reality: payment declined, followed by late-night experiments with Whisper, Parakeet, GigaAM, and WER](@/assets/images/003-russian-speech-transcription/05-correction-models.png)

## What didn't work

### A term dictionary fixed familiar errors and created new ones

The first idea was obvious: build a replacement dictionary. The model writes "клот", I replace it with Claude. It writes "кафка", I replace it with Kafka.

A dictionary compiled from short IT recordings improved the results on those same recordings by 6 to 13 percentage points. But on a long recording that hadn't been used to build the dictionary, the gain was only 0.3 to 0.5 points. Fixing already known errors turned out to be easier than fixing new ones.

Then I took a large dictionary of 8,130 terms and ran it over the archive. "Нас" ("us") became NAS 1,246 times; "нет" ("no") became .NET 864 times. On IT texts, the dictionary removed 94 errors, but on meetings it added 24.

A filter based on word frequencies helped: don't replace a word if the Cyrillic form is used at least as often as the Latin one. After cleanup, the number of replacements across the archive dropped from 3,175 to 449. So the problem wasn't with dictionaries in general, but with unconditional replacements that ignored ambiguity.

### Overlapping audio chunks didn't improve whole recordings

The models received audio in chunks of up to 20 seconds. There were more errors near the chunk boundaries than in the middle. Adding a two-second overlap seemed logical, so the model could hear the beginning and end again.

On 74 short excerpts, WER dropped by 0.4 percentage points. On whole recordings, it rose from 30.8% to 31.3%. The improvement on the short test didn't hold up on the long one.

Then it turned out that words next to an ordinary pause, where there was no cut, were also recognized less accurately. I had linked the problem to chunking, even though a substantial part of it was related to phrase boundaries.

### A prompt improved one type of speech and made another worse

I tried telling Whisper how to write English terms. With large-v3, WER on the IT test dropped from 59.8% to 58.1%. But on meetings, it rose from 27.1% to 66.7%.

You can't evaluate a prompt only on the examples it was added for. In my task, the model had to handle both the terminology and the rest of the conversation.

### A smarter metric didn't improve the cascade

I trained a metric to better distinguish similar versions from GigaAM and Parakeet. Its own AUC increased from 0.926 to 0.941. The cascade's WER didn't improve.

In this setup, even a perfect choice among the replacements under consideration could have gained only about 0.3 percentage points on meetings. Helpful and harmful replacements often sounded equally similar. Similarity alone wasn't enough to establish the correct answer.

I also tried taking Parakeet's confidence into account. On meetings, this removed 0.2 points of WER; on IT speech, it added the same amount. There was no noticeable gain for my version of the pipeline.

## How I checked corrections on real meetings

A single final percentage isn't enough. I needed to see which words were changing and why. Next, I had to check everything on the 230,000-word archive. That took about 250 hours of background processing.

I made the folder with transcripts into a git repository. Each processing step was saved as a separate commit. In the diff, I could inspect a replacement alongside the neighboring remarks.

This revealed errors that are easy to miss behind an average WER. VPN became SPN. "Квик" became Quick. "НПР1" was shortened to NPR and lost the digit.

In a work conversation, changes like these can matter more than a few corrected ordinary words. Especially when system names, identifiers, and numbers are involved.

## That's how experiments with models turned into "Recorder"

Recorder uses the same pair of models: GigaAM provides the base, and Parakeet corrects terms. The text appears right after GigaAM's first pass, and the corrections follow in the background.

Recorder records app audio and the microphone separately. It uses ScreenCaptureKit for system audio. No virtual audio driver and no bots in meetings. It works for calls in Zoom, Yandex Telemost, Google Meet, Teams, and other apps.

The two tracks proved useful for speaker separation. One contains the microphone, the other the people I'm talking to. Speaker identification runs on the separate tracks, so the system doesn't have to untangle everyone from one mix from the start.

## So, how do you convert audio and video to text for free, with no SMS required?

[If you have a Mac, download Recorder from the app's page.](https://pahaz.8iq.dev/recorder/) The app accepts mp3, m4a, wav, mp4, and mov. No recording length limits. You can transcribe a saved call or turn speech from a video into text without uploading the file to an external service.

The current workflow is designed for Russian speech with English borrowings. It isn't very suitable for meetings held entirely in English.

If you're on Windows or Linux, or [you want to reproduce the result yourself, there's a prompt your coding agent can use to do it](https://gist.github.com/pahaz/db2faf33bd0e1ca45b815b0f705a9b41).

## What worked out, and what's left for the next article

I started by trying to preserve the details of work meetings. In the end, I spent most of my time checking errors from different models, tuning parameters, and annotating data.

The short version: GigaAM handles ordinary Russian conversation better; Parakeet helps with terms. Their cascade didn't win every test. It turned out to be a good compromise for meetings that mix ordinary speech, technical discussions, and English borrowings.

The next question: can this approach be generalized so that the base, the correction models, and the order in which they are applied don't have to be chosen manually? I experimented with that too and found good cascade chains. But that's a separate story with its own series of measurements.

If there's interest in this article, I'll write a follow-up.

PS: if you have an annotated audio-to-text dataset and are willing to share it, drop me a message.
