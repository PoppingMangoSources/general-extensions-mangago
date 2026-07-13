/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import { getUsePostIds } from "./forms";
import type { MangaStreamGeneric } from "./main";
import { type MangaStreamDiscoverSection, type MangaStreamSearchResultItem } from "./models";
import { convertDate } from "./utils";

export class MangaStreamParser {
  parseMangaDetails($: CheerioAPI, mangaId: string, source: MangaStreamGeneric): SourceManga {
    const titles: string[] = [];
    titles.push($("h1.entry-title").text().trim());

    const altTitles = $(
      `span:contains(${source.mangaSelectorAlternativeTitles}), b:contains(${source.mangaSelectorAlternativeTitles})+span, .imptdt:contains(${source.mangaSelectorAlternativeTitles}) i, h1.entry-title+span`,
    )
      .contents()
      .remove()
      .last()
      .text()
      .split(","); // Language dependant
    for (const title of altTitles) {
      if (title == "") {
        continue;
      }
      titles.push(title.trim());
    }

    const author = $(
      `span:contains(${source.mangaSelectorAuthor}), .fmed b:contains(${source.mangaSelectorAuthor})+span, .imptdt:contains(${source.mangaSelectorAuthor}) i, tr td:contains(${source.mangaSelectorAuthor}) + td`,
    )
      .contents()
      .remove()
      .last()
      .text()
      .trim(); // Language dependant
    const artist = $(
      `span:contains(${source.mangaSelectorArtist}), .fmed b:contains(${source.mangaSelectorArtist})+span, .imptdt:contains(${source.mangaSelectorArtist}) i, tr td:contains(${source.mangaSelectorArtist}) + td`,
    )
      .contents()
      .remove()
      .last()
      .text()
      .trim(); // Language dependant
    const image = this.getImageSrc($("img", 'div[itemprop="image"]'));
    const description = $('div[itemprop="description"]  p').text().trim();

    const arrayTags: Tag[] = [];
    for (const tag of $("a", source.mangaTagSelectorBox).toArray()) {
      const title = $(tag).text().trim();
      const id = this.idCleaner($(tag).attr("href") ?? "");
      if (!id || !title) {
        continue;
      }
      arrayTags.push({ id, title });
    }

    const rawStatus = $(
      `span:contains(${source.mangaSelectorStatus}), .fmed b:contains(${source.mangaSelectorStatus})+span, .imptdt:contains(${source.mangaSelectorStatus}) i`,
    )
      .contents()
      .remove()
      .last()
      .text()
      .trim();
    let status;
    switch (rawStatus.toLowerCase()) {
      case source.mangaStatusTypes.ONGOING.toLowerCase():
        status = "Ongoing";
        break;
      case source.mangaStatusTypes.COMPLETED.toLowerCase():
        status = "Completed";
        break;
      default:
        status = "Ongoing";
        break;
    }

    const tagSections: TagSection[] = [
      {
        id: "0",
        title: "genres",
        tags: arrayTags,
      },
    ];

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: titles.shift() as string,
        secondaryTitles: titles,
        thumbnailUrl: image,
        status,
        author: author == "" ? "Unknown" : author,
        artist: artist == "" ? "Unknown" : artist,
        synopsis: description,
        contentRating: source.contentRating,
        tagGroups: tagSections,
      },
    };
  }

  parseChapterList($: CheerioAPI, sourceManga: SourceManga, source: MangaStreamGeneric): Chapter[] {
    const chapters: Chapter[] = [];
    let sortingIndex = 0;
    let language = source.language;

    // Usually for Manhwa sites
    if (sourceManga.mangaId.toUpperCase().endsWith("-RAW") && source.language == "🇬🇧")
      language = "🇰🇷";

    for (const chapter of $("li", "div#chapterlist").toArray()) {
      const title = $("span.chapternum", chapter).text().trim().replace(/\s+/g, " ");
      const date = convertDate($("span.chapterdate", chapter).text().trim(), source);
      // Set data-num attribute as id
      const id = (chapter.attribs["data-num"] ?? "").replaceAll(" ", "-");
      const chapterNumberRegex = id.match(/(\d+\.?\d?)+/);
      let chapterNumber = 0;
      if (chapterNumberRegex && chapterNumberRegex[1]) {
        chapterNumber = Number(chapterNumberRegex[1]);
      }

      const isLocked = $(".text-gold", chapter).length;
      if (isLocked) {
        continue;
      }

      if (!id || typeof id === "undefined") {
        throw new Error(
          `Could not parse out ID when getting chapters for postId: ${sourceManga.mangaId}`,
        );
      }

      chapters.push({
        chapterId: id, // Store chapterNumber as id
        langCode: language,
        chapNum: chapterNumber,
        title,
        publishDate: date,
        sortingIndex,
        volume: 0,
        version: "",
        sourceManga,
      });
      sortingIndex--;
    }

    if (chapters.length == 0) {
      throw new Error(`Couldn't find any chapters for mangaId: ${sourceManga.mangaId}!`);
    }

    return chapters.map((chapter) => {
      if (chapter.sortingIndex != undefined) chapter.sortingIndex += chapters.length;
      return chapter;
    });
  }

  parseChapterDetails($: CheerioAPI, chapter: Chapter): ChapterDetails {
    const pages: string[] = [];

    //@ts-expect-error Ignore index
    const readerScript = $("script").filter((i, el) => {
      return $(el).html()?.includes("ts_reader.run");
    });

    if (!readerScript) {
      throw new Error(
        `Failed to find page details script for manga ${chapter.sourceManga.mangaId}`,
      ); // If null, throw error, else parse data to json.
    }

    const scriptMatch = readerScript.html()?.match(/ts_reader\.run\((.*?(?=\);|},))/);

    interface obj {
      sources: {
        images: string[];
      }[];
    }

    let scriptStr: string = "";
    let scriptObj: obj = {
      sources: [],
    };

    if (scriptMatch && scriptMatch[1]) {
      scriptStr = scriptMatch[1];
    }

    if (!scriptStr) {
      throw new Error(`Failed to parse script for manga ${chapter.sourceManga.mangaId}`); // If null, throw error, else parse data to json.
    }

    if (!scriptStr.endsWith("}")) {
      scriptStr = scriptStr + "}";
    }

    scriptObj = JSON.parse(scriptStr) as obj;

    if (!scriptObj?.sources) {
      throw new Error(`Failed for find sources property for manga ${chapter.sourceManga.mangaId}`);
    }

    for (const index of scriptObj.sources) {
      // Check all sources, if empty continue.
      if (index?.images.length == 0) continue;
      index.images.map((p: string) => pages.push(encodeURI(p.trim())));
    }

    const chapterDetails = {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: pages,
    };

    return chapterDetails;
  }

  parseTags($: CheerioAPI): TagSection[] {
    const tagSections: TagSection[] = [
      { id: "0", title: "genres", tags: [] },
      { id: "1", title: "status", tags: [] },
      { id: "2", title: "type", tags: [] },
      { id: "3", title: "order", tags: [] },
    ];

    const sectionDropDowns = $("ul.dropdown-menu.c4.genrez, ul.dropdown-menu.c1").toArray();
    for (let i = 0; i < 4; ++i) {
      const sectionDropdown = sectionDropDowns[i];
      const section = tagSections[i];
      if (!sectionDropdown || !section) {
        continue;
      }

      for (const tag of $("li", sectionDropdown).toArray()) {
        const title = $("label", tag).text().trim();
        const id = `${section.title}_${$("input", tag).attr("value")}`;

        if (!id || !title) {
          continue;
        }

        section.tags.push({ id, title });
      }
    }

    return tagSections;
  }

  parseSearchResults($: CheerioAPI): MangaStreamSearchResultItem[] {
    const results: MangaStreamSearchResultItem[] = [];

    for (const obj of $("div.bs", "div.listupd").toArray()) {
      const slug: string =
        ($("a", obj).attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";
      const path: string =
        ($("a", obj).attr("href") ?? "").replace(/\/$/, "").split("/").slice(-2).shift() ?? "";
      if (!slug || !path) {
        throw new Error(`Unable to parse slug (${slug}) or path (${path})!`);
      }

      const title: string = $("a", obj).attr("title") ?? "";
      const image = this.getImageSrc($("img", obj)) ?? "";
      const subtitle = $("div.epxs", obj).text().trim();

      results.push({
        mangaId: slug,
        imageUrl: image,
        title: title,
        subtitle: subtitle,
        path,
      });
    }

    return results;
  }

  async parseHomeSection(
    $: CheerioAPI,
    section: MangaStreamDiscoverSection,
    source: MangaStreamGeneric,
  ): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];

    const mangas = section.selectorFunc($);
    if (!mangas.length) {
      console.log(`Unable to parse valid ${section.title} section!`);
      return items;
    }

    for (const manga of mangas.toArray()) {
      const title = section.titleSelectorFunc($, manga);
      $();
      const image = this.getImageSrc($("img", manga)) ?? "";
      const subtitle = section.subtitleSelectorFunc($, manga) ?? "";

      const slug: string = this.idCleaner($("a", manga).attr("href") ?? "");
      const path: string =
        ($("a", manga).attr("href") ?? "").replace(/\/$/, "").split("/").slice(-2).shift() ?? "";
      const postId = $("a", manga).attr("rel") ?? "";
      const mangaId: string = getUsePostIds()
        ? isNaN(Number(postId))
          ? await source.slugToPostId(slug, path)
          : postId
        : slug;

      if (!mangaId || !title) {
        console.log(
          `Failed to parse homepage sections for ${source.domain} title (${title}) mangaId (${mangaId})`,
        );
        continue;
      }
      let result: DiscoverSectionItem;
      switch (section.id) {
        case "featured":
          result = this.buildFeaturedTitle(mangaId, image, title);
          break;
        case "popular":
          result = this.buildPopularTitle(mangaId, image, title, subtitle);
          break;
        case "latest_updates":
        default:
          result = this.buildLatestTitle(mangaId, image, title, subtitle);
          break;
      }

      items.push(result);
    }

    return items;
  }

  buildFeaturedTitle(mangaId: string, imageUrl: string, title: string): DiscoverSectionItem {
    return {
      mangaId,
      imageUrl,
      title,
      type: "featuredCarouselItem",
    };
  }

  buildPopularTitle(
    mangaId: string,
    imageUrl: string,
    title: string,
    subtitle: string,
  ): DiscoverSectionItem {
    return {
      type: "prominentCarouselItem",
      imageUrl,
      mangaId,
      title,
      subtitle,
    };
  }

  buildLatestTitle(
    mangaId: string,
    imageUrl: string,
    title: string,
    chapterId: string,
  ): DiscoverSectionItem {
    return {
      type: "chapterUpdatesCarouselItem",
      mangaId,
      imageUrl,
      title,
      chapterId,
    };
  }

  isLastPage = ($: CheerioAPI, id: string): boolean => {
    let isLast = true;
    if (id == "view_more") {
      const hasNext = Boolean($("a.r")[0]);
      if (hasNext) {
        isLast = false;
      }
    }

    if (id == "search_request") {
      const hasNext = Boolean($("a.next.page-numbers")[0]);
      if (hasNext) {
        isLast = false;
      }
    }

    return isLast;
  };

  getImageSrc(imageObj: Cheerio<Element> | undefined): string {
    let image: string | undefined;
    if (typeof imageObj?.attr("data-src") != "undefined") {
      image = imageObj?.attr("data-src");
    } else if (typeof imageObj?.attr("data-lazy-src") != "undefined") {
      image = imageObj?.attr("data-lazy-src");
    } else if (typeof imageObj?.attr("srcset") != "undefined") {
      image = imageObj?.attr("srcset")?.split(" ")[0] ?? "";
    } else if (typeof imageObj?.attr("src") != "undefined") {
      image = imageObj?.attr("src");
    } else if (typeof imageObj?.attr("data-cfsrc") != "undefined") {
      image = imageObj?.attr("data-cfsrc");
    } else {
      image = "";
    }

    image = image?.split("?resize")[0] ?? "";
    image = image.replace(/^\/\//, "https://");
    image = image.replace(/^\//, "https:/");

    return encodeURI(decodeURI(image?.trim()));
  }

  protected idCleaner(str: string): string {
    let cleanId: string = str;
    cleanId = cleanId.replace(/\/$/, "");
    cleanId = cleanId.split("/").pop() ?? "";

    return cleanId;
  }
}
