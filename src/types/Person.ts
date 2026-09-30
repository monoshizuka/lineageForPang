/** 唯一标识一个人的类型。 */
export type PersonId = string;

/** 项目中用于描述人员的基础类型。 */
export interface Person {
  /** 人员唯一标识。 */
  id: PersonId;

  /** 人员名称。 */
  name: string;
}

/** 世系树中用于展示一位人物的条目。 */
export interface PersonTreeItem {
  /** 当前人物唯一标识。 */
  id: number;

  /** 父级人物唯一标识。 */
  pId: number | null;

  /** 世系信息，例如“二世”或“2”。 */
  generation: string;

  /** 用于排序和比较的数字世系；上代为 -2，本代为 -1。 */
  generationNumber: number | null;

  /** 人物姓名。 */
  name: string;

  /** 人物别号。 */
  alias: string | null;

  /** 出生日期，建议使用 YYYY-MM-DD 格式。 */
  birthDate: string | null;

  /** 去世日期，建议使用 YYYY-MM-DD 格式。 */
  deathDate: string | null;

  /** 补充备注。 */
  notes: string | null;

  /** 性别。 */
  sex: '男' | '女';

  /** 人物类型：宗亲或配偶。 */
  type: '宗亲' | '配偶';

  /** 子级人物或配偶列表。 */
  chirdrensList: PersonTreeItem[] | null;
}
