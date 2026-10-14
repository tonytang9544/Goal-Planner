export interface Board {
  id: string
  name: string
  columns: BoardColumn[]
  labels: Label[]
  createdAt: string
  updatedAt: string
}

export interface BoardColumn {
  id: string
  boardId: string
  name: string
  position: number
  cards: Card[]
  createdAt: string
  updatedAt: string
}

export interface Card {
  id: string
  columnId: string
  title: string
  description: string | null
  labelIds: string[]
  position: number
  isCompleted: boolean
  dueAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Label {
  id: string
  boardId: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
}
