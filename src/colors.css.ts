import { createTheme } from '@vanilla-extract/css';
import { color } from 'folds';

export const silverTheme = createTheme(color, {
  Background: {
    Container: '#DEDEDE',
    ContainerHover: '#D3D3D3',
    ContainerActive: '#C7C7C7',
    ContainerLine: '#BBBBBB',
    OnContainer: '#000000',
  },

  Surface: {
    Container: '#EAEAEA',
    ContainerHover: '#DEDEDE',
    ContainerActive: '#D3D3D3',
    ContainerLine: '#C7C7C7',
    OnContainer: '#000000',
  },

  SurfaceVariant: {
    Container: '#DEDEDE',
    ContainerHover: '#D3D3D3',
    ContainerActive: '#C7C7C7',
    ContainerLine: '#BBBBBB',
    OnContainer: '#000000',
  },

  Primary: {
    Main: '#1245A8',
    MainHover: '#103E97',
    MainActive: '#0F3B8F',
    MainLine: '#0E3786',
    OnMain: '#FFFFFF',
    Container: '#C4D0E9',
    ContainerHover: '#B8C7E5',
    ContainerActive: '#ACBEE1',
    ContainerLine: '#A0B5DC',
    OnContainer: '#0D3076',
  },

  Secondary: {
    Main: '#000000',
    MainHover: '#171717',
    MainActive: '#232323',
    MainLine: '#2F2F2F',
    OnMain: '#EAEAEA',
    Container: '#C7C7C7',
    ContainerHover: '#BBBBBB',
    ContainerActive: '#AFAFAF',
    ContainerLine: '#A4A4A4',
    OnContainer: '#0C0C0C',
  },

  Success: {
    Main: '#017343',
    MainHover: '#01683C',
    MainActive: '#016239',
    MainLine: '#015C36',
    OnMain: '#FFFFFF',
    Container: '#BFDCD0',
    ContainerHover: '#B3D5C7',
    ContainerActive: '#A6CEBD',
    ContainerLine: '#99C7B4',
    OnContainer: '#01512F',
  },

  Warning: {
    Main: '#864300',
    MainHover: '#793C00',
    MainActive: '#723900',
    MainLine: '#6B3600',
    OnMain: '#FFFFFF',
    Container: '#E1D0BF',
    ContainerHover: '#DBC7B2',
    ContainerActive: '#D5BDA6',
    ContainerLine: '#CFB499',
    OnContainer: '#5E2F00',
  },

  Critical: {
    Main: '#9D0F0F',
    MainHover: '#8D0E0E',
    MainActive: '#850D0D',
    MainLine: '#7E0C0C',
    OnMain: '#FFFFFF',
    Container: '#E7C3C3',
    ContainerHover: '#E2B7B7',
    ContainerActive: '#DDABAB',
    ContainerLine: '#D89F9F',
    OnContainer: '#6E0B0B',
  },

  Other: {
    FocusRing: 'rgba(0 0 0 / 50%)',
    Shadow: 'rgba(0 0 0 / 20%)',
    Overlay: 'rgba(0 0 0 / 50%)',
  },
});

const darkThemeData = {
  Background: {
    Container: '#1A1A1A',
    ContainerHover: '#262626',
    ContainerActive: '#333333',
    ContainerLine: '#404040',
    OnContainer: '#F2F2F2',
  },

  Surface: {
    Container: '#262626',
    ContainerHover: '#333333',
    ContainerActive: '#404040',
    ContainerLine: '#4D4D4D',
    OnContainer: '#F2F2F2',
  },

  SurfaceVariant: {
    Container: '#333333',
    ContainerHover: '#404040',
    ContainerActive: '#4D4D4D',
    ContainerLine: '#595959',
    OnContainer: '#F2F2F2',
  },

  Primary: {
    Main: '#BDB6EC',
    MainHover: '#B2AAE9',
    MainActive: '#ADA3E8',
    MainLine: '#A79DE6',
    OnMain: '#2C2843',
    Container: '#413C65',
    ContainerHover: '#494370',
    ContainerActive: '#50497B',
    ContainerLine: '#575086',
    OnContainer: '#E3E1F7',
  },

  Secondary: {
    Main: '#FFFFFF',
    MainHover: '#E5E5E5',
    MainActive: '#D9D9D9',
    MainLine: '#CCCCCC',
    OnMain: '#1A1A1A',
    Container: '#404040',
    ContainerHover: '#4D4D4D',
    ContainerActive: '#595959',
    ContainerLine: '#666666',
    OnContainer: '#F2F2F2',
  },

  Success: {
    Main: '#85E0BA',
    MainHover: '#70DBAF',
    MainActive: '#66D9A9',
    MainLine: '#5CD6A3',
    OnMain: '#0F3D2A',
    Container: '#175C3F',
    ContainerHover: '#1A6646',
    ContainerActive: '#1C704D',
    ContainerLine: '#1F7A54',
    OnContainer: '#CCF2E2',
  },

  Warning: {
    Main: '#E3BA91',
    MainHover: '#DFAF7E',
    MainActive: '#DDA975',
    MainLine: '#DAA36C',
    OnMain: '#3F2A15',
    Container: '#5E3F20',
    ContainerHover: '#694624',
    ContainerActive: '#734D27',
    ContainerLine: '#7D542B',
    OnContainer: '#F3E2D1',
  },

  Critical: {
    Main: '#E69D9D',
    MainHover: '#E28D8D',
    MainActive: '#E08585',
    MainLine: '#DE7D7D',
    OnMain: '#401C1C',
    Container: '#602929',
    ContainerHover: '#6B2E2E',
    ContainerActive: '#763333',
    ContainerLine: '#803737',
    OnContainer: '#F5D6D6',
  },

  Other: {
    FocusRing: 'rgba(255, 255, 255, 0.5)',
    Shadow: 'rgba(0, 0, 0, 1)',
    Overlay: 'rgba(0, 0, 0, 0.8)',
  },
};

export const darkTheme = createTheme(color, darkThemeData);

export const ashTheme = createTheme(color, {
  ...darkThemeData,
  // Neutral grey palette inspired by Discord's Ash theme (#2E2E34 brand ref,
  // #DADDDA text). Pattern: R≈G, B slightly higher (≈+6), steps of ~10.
  Background: {
    Container: '#1E1E24',
    ContainerHover: '#28282E',
    ContainerActive: '#323238',
    ContainerLine: '#3C3C43',
    OnContainer: '#DADDDA',
  },

  Surface: {
    Container: '#28282E',
    ContainerHover: '#323238',
    ContainerActive: '#3C3C43',
    ContainerLine: '#46464E',
    OnContainer: '#DADDDA',
  },

  SurfaceVariant: {
    Container: '#323238',
    ContainerHover: '#3C3C43',
    ContainerActive: '#46464E',
    ContainerLine: '#505059',
    OnContainer: '#DADDDA',
  },

  Secondary: {
    Main: '#DADDDA',
    MainHover: '#C3C6C3',
    MainActive: '#B7BAB7',
    MainLine: '#ABAEAB',
    OnMain: '#1E1E24',
    Container: '#3C3C43',
    ContainerHover: '#46464E',
    ContainerActive: '#505059',
    ContainerLine: '#5A5A63',
    OnContainer: '#DADDDA',
  },
});

export const sepiaTheme = createTheme(color, {
  // Background is the sidebar/outer layer — noticeably darker than Surface
  // so the two-tone layout reads clearly.
  Background: {
    Container: '#E0CFA8',
    ContainerHover: '#D7C69C',
    ContainerActive: '#CEBD90',
    ContainerLine: '#C0AE80',
    OnContainer: '#1E1509',
  },

  // Surface is the main chat/content area — light parchment.
  Surface: {
    Container: '#F5EDD8',
    ContainerHover: '#EDE4CC',
    ContainerActive: '#E5DBBF',
    ContainerLine: '#D6CAB0',
    OnContainer: '#1E1509',
  },

  SurfaceVariant: {
    Container: '#EDE4CC',
    ContainerHover: '#E5DBBF',
    ContainerActive: '#DCCEAC',
    ContainerLine: '#CCBF98',
    OnContainer: '#1E1509',
  },

  Primary: {
    Main: '#7A4E1A',
    MainHover: '#6D4516',
    MainActive: '#663F13',
    MainLine: '#5E3910',
    OnMain: '#FFFFFF',
    Container: '#E5D0B0',
    ContainerHover: '#DEC7A2',
    ContainerActive: '#D7BE94',
    ContainerLine: '#CEB585',
    OnContainer: '#5E3F1A',
  },

  Secondary: {
    Main: '#1E1509',
    MainHover: '#2C1F0C',
    MainActive: '#3A2B14',
    MainLine: '#44331A',
    OnMain: '#F5EDD8',
    Container: '#D0C4A0',
    ContainerHover: '#C6B890',
    ContainerActive: '#BCAD81',
    ContainerLine: '#AFA170',
    OnContainer: '#1E1509',
  },

  Success: {
    Main: '#2D7A4F',
    MainHover: '#296E47',
    MainActive: '#276843',
    MainLine: '#24623F',
    OnMain: '#FFFFFF',
    Container: '#C5DFD0',
    ContainerHover: '#B8D7C6',
    ContainerActive: '#ABCEBB',
    ContainerLine: '#9EC6B1',
    OnContainer: '#1F5536',
  },

  Warning: {
    Main: '#9A5200',
    MainHover: '#8B4A00',
    MainActive: '#824500',
    MainLine: '#7A4000',
    OnMain: '#FFFFFF',
    Container: '#E8D4B8',
    ContainerHover: '#E0C9A6',
    ContainerActive: '#D9BE94',
    ContainerLine: '#D1B382',
    OnContainer: '#6B3900',
  },

  Critical: {
    Main: '#B52B2B',
    MainHover: '#A32727',
    MainActive: '#9A2525',
    MainLine: '#912222',
    OnMain: '#FFFFFF',
    Container: '#EDD0C8',
    ContainerHover: '#E7C3BA',
    ContainerActive: '#E1B6AC',
    ContainerLine: '#DAA89E',
    OnContainer: '#7E1E1E',
  },

  Other: {
    FocusRing: 'rgba(44, 31, 12, 0.5)',
    Shadow: 'rgba(44, 31, 12, 0.2)',
    Overlay: 'rgba(44, 31, 12, 0.5)',
  },
});

export const butterTheme = createTheme(color, {
  ...darkThemeData,
  Background: {
    Container: '#1A1916',
    ContainerHover: '#262621',
    ContainerActive: '#33322C',
    ContainerLine: '#403F38',
    OnContainer: '#FFFBDE',
  },

  Surface: {
    Container: '#262621',
    ContainerHover: '#33322C',
    ContainerActive: '#403F38',
    ContainerLine: '#4D4B43',
    OnContainer: '#FFFBDE',
  },

  SurfaceVariant: {
    Container: '#33322C',
    ContainerHover: '#403F38',
    ContainerActive: '#4D4B43',
    ContainerLine: '#59584E',
    OnContainer: '#FFFBDE',
  },

  Secondary: {
    Main: '#FFFBDE',
    MainHover: '#E5E2C8',
    MainActive: '#D9D5BD',
    MainLine: '#CCC9B2',
    OnMain: '#1A1916',
    Container: '#403F38',
    ContainerHover: '#4D4B43',
    ContainerActive: '#59584E',
    ContainerLine: '#666459',
    OnContainer: '#F2EED3',
  },
});
