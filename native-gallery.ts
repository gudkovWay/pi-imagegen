import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { matchesKey, isKeyRelease, truncateToWidth, type Component } from "@oh-my-pi/pi-tui";
import { nativeImageNode } from "@oh-my-pi/pi-tui/native/blobs";
import { col, node, row, text } from "@oh-my-pi/pi-tui/native/describe";
import type { NativeNode, NativeUiEvent } from "@oh-my-pi/pi-tui/native/node";

export interface GalleryItem {
	imageId: string;
	savedPath: string;
	mimeType: string;
}

export type GalleryChoice = { action: "select" | "annotate"; item: GalleryItem } | undefined;

type Picture = { bytes: Uint8Array } | { error: string };

function galleryButton(label: string, action: string, active = false, disabled = false): NativeNode {
	return node("row", {
		role: "omp.btn",
		tone: disabled ? "muted" : active ? "accent" : undefined,
		actions: disabled ? undefined : { click: action },
	}, [text(`${active ? "› " : ""}${label}`)], action);
}

function pictureNode(item: GalleryItem, picture: Picture | undefined, height: number, action: string, key: string): NativeNode {
	if (!picture) return node("text", { text: `Загрузка ${basename(item.savedPath)}…` }, undefined, key);
	if ("error" in picture) return node("text", { text: `Не удалось прочитать ${basename(item.savedPath)}: ${picture.error}`, tone: "error" }, undefined, key);
	return nativeImageNode(picture.bytes, item.mimeType, {
		alt: basename(item.savedPath),
		max: { h: `${height}lines` },
		actions: { click: action },
	}, key);
}

export class GalleryPreview implements Component {
	private readonly view: NativeNode;

	constructor(items: readonly GalleryItem[], private readonly open: () => void) {
		const first = items[0];
		const children: NativeNode[] = [];
		if (first) {
			let picture: Picture;
			try {
				picture = { bytes: readFileSync(first.savedPath) };
			} catch (error) {
				picture = { error: error instanceof Error ? error.message : String(error) };
			}
			children.push(pictureNode(first, picture, 9, "gallery-open", "preview"));
			children.push(galleryButton(`Смотреть варианты (${items.length})`, "gallery-open"));
		} else {
			children.push(text("В галерее пока нет изображений. Добавь файлы через /img import."));
		}
		this.view = col(children, { gap: "sm" });
	}

	describe(): NativeNode { return this.view; }
	render(width: number): string[] { return [truncateToWidth("Галерея изображений · /img gallery", width)]; }
	invalidate(): void {}
	handleNativeEvent(event: NativeUiEvent): void {
		if (event.type === "action" && event.act === "gallery-open") this.open();
	}
}

export class GalleryModal implements Component {
	readonly nativeOverlay = { role: "omp.overlay.image-gallery", head: "Галерея изображений", size: "lg", anchor: "center" } as const;
	private index = 0;
	private focus = 2;
	private readonly pictures = new Map<number, Picture>();
	private readonly pending = new Set<number>();
	private disposed = false;
	private view: NativeNode | undefined;
	private viewWidth = 0;
	private readonly actions = ["previous", "next", "select", "annotate", "close"] as const;

	constructor(
		private readonly items: readonly GalleryItem[],
		private readonly repaint: () => void,
		private readonly finish: (choice: GalleryChoice) => void,
	) {
		this.loadVisible();
	}

	private loadVisible(): void {
		const start = Math.max(0, Math.min(this.index - 2, this.items.length - 5));
		for (let at = start; at < Math.min(this.items.length, start + 5); at++) {
			if (this.pictures.has(at) || this.pending.has(at)) continue;
			this.pending.add(at);
			void readFile(this.items[at].savedPath).then(
				bytes => this.loaded(at, { bytes }),
				error => this.loaded(at, { error: error instanceof Error ? error.message : String(error) }),
			);
		}
	}

	private loaded(index: number, picture: Picture): void {
		if (this.disposed) return;
		this.pending.delete(index);
		this.pictures.set(index, picture);
		this.changed();
	}

	private changed(): void {
		this.view = undefined;
		this.repaint();
	}

	private move(index: number): void {
		const next = Math.max(0, Math.min(this.items.length - 1, index));
		if (next === this.index) return;
		this.index = next;
		this.loadVisible();
		this.changed();
	}

	private activate(action: string): void {
		if (this.disposed) return;
		if (action === "previous") this.move(this.index - 1);
		else if (action === "next") this.move(this.index + 1);
		else if (action === "close") this.finish(undefined);
		else if (action === "select" || action === "annotate") {
			const picture = this.pictures.get(this.index);
			const item = this.items[this.index];
			if (item && picture && "bytes" in picture) this.finish({ action, item });
		}
	}

	handleInput(input: string): void {
		if (isKeyRelease(input)) return;
		if (matchesKey(input, "escape")) this.activate("close");
		else if (matchesKey(input, "left")) this.move(this.index - 1);
		else if (matchesKey(input, "right")) this.move(this.index + 1);
		else if (matchesKey(input, "tab") || matchesKey(input, "shift+tab")) {
			const direction = matchesKey(input, "shift+tab") ? -1 : 1;
			this.focus = (this.focus + direction + this.actions.length) % this.actions.length;
			this.changed();
		} else if (matchesKey(input, "enter")) this.activate(this.actions[this.focus]);
	}

	handleNativeEvent(event: NativeUiEvent): void {
		if (event.type !== "action") return;
		if (event.act === "slide" && event.value !== undefined) {
			const index = Number(event.value);
			if (Number.isInteger(index) && index >= 0 && index < this.items.length) this.move(index);
		} else this.activate(event.act);
	}

	describe(cx: { cols: number }): NativeNode {
		if (this.view && this.viewWidth === cx.cols) return this.view;
		this.viewWidth = cx.cols;
		const item = this.items[this.index];
		if (!item) return col([text("В галерее нет изображений."), galleryButton("Закрыть", "close")]);
		const narrow = cx.cols < 70;
		const ready = this.pictures.get(this.index);
		const labels = ["Назад", "Дальше", "Выбрать этот", "Plannotator", "Закрыть"];
		const buttons = this.actions.map((action, index) => galleryButton(
			labels[index], action, this.focus === index,
			(action === "previous" && this.index === 0) || (action === "next" && this.index === this.items.length - 1) || ((action === "select" || action === "annotate") && (!ready || "error" in ready)),
		));
		const start = Math.max(0, Math.min(this.index - 2, this.items.length - 5));
		const thumbnails = this.items.slice(start, start + 5).map((entry, offset) => {
			const at = start + offset;
			return node("col", { grow: 1, basis: 1 / Math.min(5, this.items.length), min: { w: 0 }, actions: { click: `slide=${at}` } }, [
				pictureNode(entry, this.pictures.get(at), narrow ? 2 : 3, `slide=${at}`, `thumb-${at}`),
				text(`${at === this.index ? "● " : ""}${at + 1}`, { tone: at === this.index ? "accent" : undefined }),
			], `item-${at}`);
		});
		this.view = col([
			text(`${this.index + 1} / ${this.items.length} · ${basename(item.savedPath)}`),
			pictureNode(item, ready, narrow ? 13 : 25, "zoom", "picture"),
			row(thumbnails, { gap: "sm" }),
			row(buttons, { gap: "sm", wrap: true }),
			text("← / → кадр · Tab действие · Enter выполнить · Esc закрыть"),
		], { gap: "sm" });
		return this.view;
	}

	render(width: number): string[] {
		return ["Галерея изображений", `${this.index + 1} / ${this.items.length}`, this.items[this.index]?.savedPath ?? "Нет изображений", "← / → кадр · Tab действие · Enter выполнить · Esc закрыть"].map(line => truncateToWidth(line, width));
	}

	invalidate(): void { this.view = undefined; }
	dispose(): void { this.disposed = true; this.pictures.clear(); }
}
